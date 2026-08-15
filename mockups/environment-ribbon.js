/**
 * environment-ribbon.js — mockup only. SPEC-NEXT.md §47.
 *
 * NOT APP CODE. Nothing here is imported by anything that ships. It exists so
 * the ribbon can be judged on glass before a line of real code is written.
 *
 * External file rather than inline because the live CSP is `script-src 'self'`
 * with one pinned hash and no 'unsafe-inline'. An inline script here is blocked
 * and the page renders as an empty shell.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE COLOUR MEANS
 *
 * Not an invented 0-1 index. Every SHIPS file publishes a section called
 * "individual contributions to intensity change" in which the model shows its
 * own arithmetic: what each factor is worth, IN KNOTS, cumulative from now.
 * Those columns sum exactly to the intensity forecast — checked against 94L,
 * whose factors total +45 kt while its wind goes 25 kt to 70 kt.
 *
 * So we let the model weight its own terms and simply split them into
 *   ENV  — the air and water the storm is sitting in
 *   SELF — the storm's own structure, plus the model's bookkeeping
 * and colour the cone by the ENV sum. Real unit, no guessed weights.
 *
 * This also corrects a genuine error in the earlier blended score, which
 * ranked Hernan's environment the worst of the three. SHIPS says the opposite:
 * Hernan's surroundings are worth +4 kt. He is falling apart because his own
 * structure is worth -10 kt. Environment and outcome are not the same thing
 * and this metric keeps them separate.
 */

/* =========================================================================
 * 1. REAL DATA — transcribed from the SHIPS files, nothing invented.
 *    Contribution rows are CUMULATIVE KNOTS from t=0, at hours 6..168.
 *    Position rows are at hours 0..120 — note the offset: there is no
 *    contribution column for hour 0, so the ribbon starts neutral at the fix.
 * ====================================================================== */
const CONTRIB_HRS = [6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 168];

/** Which contribution rows describe the STORM'S SURROUNDINGS. */
const ENV_TERMS = {
  sstPot:   'Warm water',
  shear:    'Shear',
  t200:     'Cold air aloft',
  thetaE:   'Moist warm air',
  rh:       'Mid-level humidity',
  envVort:  'Background spin',
  div200:   'Outflow aloft',
  tadv:     'Warm air moving in',
  ohc:      'Deep warm water',
};
/** Everything else: the storm's own structure and the model's bookkeeping.
 *  Deliberately NOT coloured — it is not the environment. */
const SELF_TERMS = ['sampleMean', 'persist', 'vtxTend', 'goes', 'riPot', 'climPeak', 'zonal', 'steer'];

const STORMS = {
  hernan: {
    label: 'Hernan', id: 'EP082026', basin: 'pacific', issued: '15 Aug 06 UTC',
    hrs:  [0, 6, 12, 18, 24, 36, 48, 60],
    v:    [30, 29, 28, 28, 28, 26, 25, 22],
    lat:  [16.3, 16.3, 16.4, 16.5, 16.5, 16.6, 16.7, 16.8],
    lonW: [133.2, 134.4, 135.5, 136.5, 137.5, 139.6, 141.7, 143.1],
    tail: 'SHIPS stops at +60 h for this storm — the rest of the file is N/A.',
    c: {
      sstPot:   [0, 1, 2, 3, 6, 11, 15],
      shearMag: [1, 1, 2, 2, 2, 0, -2],
      shearAdj: [0, 0, 0, 0, -1, 0, 0],
      shearDir: [0, -1, -2, -2, -4, -5, -6],
      t200:     [0, 0, 0, 0, 0, 0, 0],
      thetaE:   [0, 0, 0, 0, 0, 1, 1],
      rh:       [0, 0, 0, -1, -1, -1, -1],
      envVort:  [0, 0, 0, 0, 0, 0, 0],
      div200:   [0, 0, 0, 0, 0, -1, -2],
      tadv:     [0, 0, 0, 0, 0, 0, 0],
      ohc:      [0, 0, 0, 0, 0, 0, -1],
      sampleMean: [0, 1, 1, 1, 2, 2, 2],
      persist:  [0, 0, -1, -1, -1, -1, 0],
      vtxTend:  [0, -1, -1, -2, -2, -4, -6],
      goes:     [-1, -1, -1, -1, -2, -5, -7],
      riPot:    [0, -1, -2, -2, -4, -4, -2],
      climPeak: [0, 0, 0, 0, 1, 1, 1],
      zonal:    [0, 0, 0, 0, 0, 0, 0],
      steer:    [0, 0, 1, 1, 1, 2, 2],
    },
  },
  lala: {
    label: 'Lala', id: 'CP012026', basin: 'pacific', issued: '15 Aug 06 UTC',
    hrs:  [0, 6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 108, 120],
    v:    [55, 56, 57, 55, 55, 54, 55, 57, 60, 63, 63, 70, 72],
    lat:  [17.6, 17.9, 18.1, 18.7, 19.3, 20.3, 20.7, 20.8, 20.9, 21.1, 21.6, 22.3, 23.0],
    lonW: [153.0, 153.8, 154.5, 155.7, 156.8, 159.9, 162.3, 164.8, 166.9, 168.8, 170.7, 172.3, 173.8],
    tail: 'The file runs to +168 h but stops publishing positions after +120 h.',
    c: {
      sstPot:   [1, 1, 2, 3, 3, 3, 2, 2, 1, 0, -1, -2, -3, -3, -2, -1],
      shearMag: [0, 0, 0, 0, 1, 3, 4, 4, 4, 4, 5, 5, 5, 4, 3, 2],
      shearAdj: [0, 0, 0, 0, 1, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      shearDir: [0, -1, -1, -2, -2, -3, -3, -3, -3, -3, -2, -2, -1, -1, 0, 0],
      t200:     [0, 0, -1, -1, 0, 1, 3, 5, 7, 9, 10, 12, 14, 16, 18, 20],
      thetaE:   [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2],
      rh:       [0, 0, 0, -1, -1, -2, -2, -2, -2, -2, -2, -2, -2, -2, -3, -3],
      envVort:  [0, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      div200:   [0, 0, 0, 0, 0, -1, -2, -3, -3, -3, -2, -1, 0, 1, 1, 2],
      tadv:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2],
      ohc:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      sampleMean: [0, 1, 1, 1, 2, 2, 2, 1, 1, 0, 0, -1, -2, -2, -3, -3],
      persist:  [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      vtxTend:  [0, 0, -2, -2, -3, -3, -3, -2, 0, -2, 2, 2, 3, 5, 8, 10],
      goes:     [0, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      riPot:    [0, -1, -1, -2, -3, -3, -2, 0, 1, 2, 3, 4, 4, 4, 4, 4],
      climPeak: [0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 3, 3, 4, 4, 5, 5],
      zonal:    [0, 0, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1],
      steer:    [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
    },
  },
  al94: {
    label: 'Invest 94L', id: 'AL942026', basin: 'atlantic', issued: '15 Aug 06 UTC',
    hrs:  [0, 6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 108, 120],
    v:    [25, 26, 27, 28, 29, 33, 38, 43, 47, 52, 55, 58, 60],
    lat:  [11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 13.1, 14.3, 15.1, 15.9, 16.3, 17.0, 17.8],
    lonW: [39.6, 41.2, 42.8, 44.3, 45.8, 48.7, 51.3, 53.6, 55.7, 57.5, 59.5, 61.7, 64.0],
    tail: 'SHIPS publishes for invests. The app has no track to hang this on yet.',
    c: {
      sstPot:   [0, 0, 1, 1, 6, 13, 20, 27, 33, 39, 42, 45, 47, 48, 51, 51],
      shearMag: [1, 2, 3, 5, 7, 7, 8, 7, 6, 4, 2, 0, -2, -4, -6, -8],
      shearAdj: [0, 0, 0, 0, 0, -1, -1, -2, -1, -1, 0, 0, 0, 0, 1, 1],
      shearDir: [0, 1, 1, 1, 2, 1, 1, 0, -1, -2, -3, -3, -4, -4, -4, -4],
      t200:     [0, -1, -1, -1, -2, -2, -2, -2, -2, -2, -1, -1, 0, 1, 2, 2],
      thetaE:   [0, 0, 0, -1, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0],
      rh:       [0, 0, 0, 0, -1, -1, -1, -1, -2, -2, -1, -1, -1, 0, 0, 0],
      envVort:  [0, 0, 0, 0, 0, 0, 0, 0, -1, -1, -2, -2, -3, -3, -3, -3],
      div200:   [0, -1, -1, -1, -2, -2, -2, -2, -1, -1, 0, 1, 2, 2, 3, 4],
      tadv:     [0, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      ohc:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0],
      sampleMean: [1, 2, 3, 5, 6, 8, 10, 11, 12, 13, 13, 14, 15, 15, 16, 16],
      persist:  [0, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0],
      vtxTend:  [0, -1, -1, -2, -5, -7, -9, -12, -14, -17, -19, -20, -20, -20, -19, -19],
      goes:     [0, 0, 0, 0, 0, -1, -1, -2, -2, -2, -2, -2, -1, -1, -1, -1],
      riPot:    [0, -1, -1, -2, -3, -3, -3, -2, -1, 0, 1, 2, 3, 3, 3, 3],
      climPeak: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
      zonal:    [0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2],
      steer:    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1],
    },
  },
};

/** CONE_CIRCLE_NM_2026, verbatim from config/constants.js. Nautical miles. */
const CONE_NM = {
  atlantic: [[12, 25], [24, 39], [36, 49], [48, 62], [60, 77], [72, 95], [96, 134], [120, 200]],
  pacific:  [[12, 25], [24, 37], [36, 48], [48, 56], [60, 66], [72, 78], [96, 106], [120, 138]],
};
/** Below the first published circle the cone tapers toward the fix. The app
 *  does this properly in lib/cone-error.js; approximated here so the near end
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
 * 2. THE METRIC — these numbers would live in config/constants.js.
 * ====================================================================== */
const ENV_KT = {
  /* Ramp domain, in knots. A genuinely hostile environment can subtract, so
     the scale has to reach below zero — but the first attempt ran -20..+40
     and nothing in the real files goes below -1, which left the bottom third
     of every ramp as dead space and crammed all three storms into the top.
     -10..+30 is the range real storms actually occupy and spreads the same
     numbers roughly 45% further apart. */
  hostile: -10,
  prime:   30,
  /* Bands, read at a glance. `max` is the upper bound in knots; `t` is where
     the band sits on the ramp.
     TWO SEPARATE DECISIONS, and both were wrong on the first pass.
     - The CUT POINTS were 0/10/25, which real storms barely cross: Hernan and
       Lala sat in one band end to end. 0/5/15 is where these storms actually
       change character, so every one of the three now crosses at least one
       boundary.
     - The SPACING is now even — 0, .25, .50, .75, 1 — rather than each band
       sitting at the middle of its own knot range. Bunching three bands into
       the lower third of the ramp was throwing away most of the contrast.
       The knot cut points carry the meaning; the colours just need to be as
       far apart as the ramp allows. */
  bands: [
    { max: -5,        t: 0.00, label: 'Tearing it down' },
    { max: 0,         t: 0.25, label: 'Working against it' },
    { max: 5,         t: 0.50, label: 'Neutral' },
    { max: 15,        t: 0.75, label: 'Helping' },
    { max: Infinity,  t: 1.00, label: 'Feeding it' },
  ],
  /* How much the factors have to agree before the words say so. */
  agreeStrong: 0.65,
  agreeWeak:   0.40,
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Shear is published as three separate rows. It is one thing to a person. */
const shearOf = (c, i) => c.shearMag[i] + c.shearAdj[i] + c.shearDir[i];

/** Every environment term at contribution column i, in knots. */
function envTermsAt(d, i) {
  const c = d.c;
  return {
    sstPot: c.sstPot[i], shear: shearOf(c, i), t200: c.t200[i],
    thetaE: c.thetaE[i], rh: c.rh[i], envVort: c.envVort[i],
    div200: c.div200[i], tadv: c.tadv[i], ohc: c.ohc[i],
  };
}
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Net knots the surroundings are worth, at contribution column i. */
const envKtAt = (d, i) => sum(Object.values(envTermsAt(d, i)));
/** What the storm's own structure is worth — shown, never coloured. */
const selfKtAt = (d, i) => sum(SELF_TERMS.map((k) => d.c[k][i]));

/** 1.0 = every factor pointing the same way. 0 = perfect tug of war. */
function agreementAt(d, i) {
  const v = Object.values(envTermsAt(d, i));
  const gross = sum(v.map(Math.abs));
  return gross === 0 ? 1 : Math.abs(sum(v)) / gross;
}

/** Position hour -> contribution column. Hour 0 has no column: neutral. */
function ktAtHour(d, hr) {
  if (hr <= 0) return 0;
  const i = CONTRIB_HRS.indexOf(hr);
  if (i === -1 || i >= d.c.sstPot.length) return 0;
  return envKtAt(d, i);
}
function colIndex(d, hr) {
  const i = CONTRIB_HRS.indexOf(hr);
  return (i === -1 || i >= d.c.sstPot.length) ? -1 : i;
}

const bandFor = (kt) => ENV_KT.bands.find((b) => kt < b.max) || ENV_KT.bands[ENV_KT.bands.length - 1];
const smoothT = (kt) => clamp01((kt - ENV_KT.hostile) / (ENV_KT.prime - ENV_KT.hostile));

/* =========================================================================
 * 3. CANDIDATE RAMPS — the thing being judged on glass.
 * ====================================================================== */
/* Three stops, not two. A two-stop grey-to-white ramp only moves brightness,
 * which is one channel; adding a hue shift in the middle roughly doubles how
 * different two neighbouring shades look, because the eye reads hue and
 * brightness separately.
 *
 * The dark end is the OCEAN COLOUR, not a grey. A grey haze over a black sea
 * still reads as something present. Fading into the sea turns the two ends
 * from "dim versus bright" into "nothing versus glowing". */
const OCEAN = '#0A1420';
const RAMPS = {
  fade: {
    label: 'Fade', stops: [OCEAN, '#4E6076', '#EAF3FA'],
    why: 'No new hue anywhere — cool slate through to white. The cone glows where the surroundings add knots and dissolves into the sea where they take them away. Cannot be confused with a category, a watch, a warning or a wind band.',
  },
  ember: {
    label: 'Ember', stops: [OCEAN, '#8A4B33', '#FFC46A'],
    why: 'Cold dark blue through burnt orange to amber — the widest colour separation of the three. Shown so the collision is visible: this amber sits between Cat 1 yellow and Cat 2 orange.',
  },
  violet: {
    label: 'Violet', stops: [OCEAN, '#5B4A9E', '#C4B0FF'],
    why: 'A hue nothing else on the globe uses, so it reads as its own thing — but it sits nearer Cat 5 magenta than is comfortable.',
  },
};
const ALPHAS = { subtle: 0.20, medium: 0.34, bold: 0.50 };

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function pair(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
/** Walk a list of colour stops. t of 0 is the first, 1 is the last. */
function mix(stops, t) {
  const n = stops.length - 1;
  const span = clamp01(t) * n;
  const i = Math.min(Math.floor(span), n - 1);
  return pair(stops[i], stops[i + 1], span - i);
}

/* =========================================================================
 * 4. STATE
 * ====================================================================== */
const state = {
  storm: 'lala', ramp: 'fade', alpha: 'medium', detail: 'steps',
  env: true, cone: true,
};
const rampT = (kt) => (state.detail === 'steps' ? bandFor(kt).t : smoothT(kt));
const colorFor = (kt) => mix(RAMPS[state.ramp].stops, rampT(kt));

/* =========================================================================
 * 5. GEOMETRY
 * ====================================================================== */
const NS = 'http://www.w3.org/2000/svg';
const W = 430, H = 330, PAD = 40;
const SUB = 10;
const NM_PER_DEG = 60;

const el = (name, attrs) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/** Resample the forecast into short slices, each carrying its own hour, its
 *  own knots and its own cone radius. Deliberately how the real layer would
 *  do it: one feature per slice, colour driven by a property. */
function densify(d) {
  const out = [];
  for (let i = 0; i < d.hrs.length - 1; i++) {
    const k0 = ktAtHour(d, d.hrs[i]), k1 = ktAtHour(d, d.hrs[i + 1]);
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB;
      out.push({
        lat:  d.lat[i]  + (d.lat[i + 1]  - d.lat[i])  * t,
        lonW: d.lonW[i] + (d.lonW[i + 1] - d.lonW[i]) * t,
        hr:   d.hrs[i]  + (d.hrs[i + 1]  - d.hrs[i])  * t,
        kt:   k0 + (k1 - k0) * t,
      });
    }
  }
  const last = d.hrs.length - 1;
  out.push({ lat: d.lat[last], lonW: d.lonW[last], hr: d.hrs[last], kt: ktAtHour(d, d.hrs[last]) });
  return out;
}

/** Equirectangular, longitudes squeezed by cos(mean latitude) so the cone
 *  circles come out round rather than stretched. */
function projector(d) {
  const latMean = sum(d.lat) / d.lat.length;
  const cos = Math.cos(latMean * Math.PI / 180);
  const xs = d.lonW.map((v) => -v * cos), ys = d.lat;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
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
    pts[i].lx = pts[i].x - dy * pts[i].r; pts[i].ly = pts[i].y + dx * pts[i].r;
    pts[i].rx = pts[i].x + dy * pts[i].r; pts[i].ry = pts[i].y - dx * pts[i].r;
  }

  if (state.cone) {
    /* --- the fill ------------------------------------------------------
     * SEAM FIX: the slices are drawn OPAQUE inside a group that carries the
     * transparency. Per-slice alpha meant every shared edge was painted
     * twice and the cone came out looking like corduroy. With group opacity
     * the overlaps cannot stack, so slices can safely overlap by a hair to
     * close sub-pixel gaps. */
    const fill = el('g', { opacity: state.env ? ALPHAS[state.alpha] : 0.08 });
    const colOf = (kt) => (state.env ? colorFor(kt) : '#FFFFFF');

    const end = pts[pts.length - 1];
    fill.appendChild(el('circle', { cx: end.x, cy: end.y, r: end.r, fill: colOf(end.kt) }));

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const c = colOf((a.kt + b.kt) / 2);
      fill.appendChild(el('polygon', {
        points: `${a.lx},${a.ly} ${b.lx},${b.ly} ${b.rx},${b.ry} ${a.rx},${a.ry}`,
        fill: c, stroke: c, 'stroke-width': 0.6,
      }));
    }
    scene.appendChild(fill);

    /* --- band boundaries -------------------------------------------------
     * A heat map reads as a heat map because of its EDGES. Without a line
     * where one band becomes the next, five steps still blur into a smudge
     * at the low fill opacity this sits at. Drawn outside the transparent
     * group so the line keeps its own strength. Smooth mode has no bands,
     * so it gets none. */
    if (state.env && state.detail === 'steps') {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (bandFor(a.kt).label === bandFor(b.kt).label) continue;
        scene.appendChild(el('line', {
          x1: b.lx, y1: b.ly, x2: b.rx, y2: b.ry,
          stroke: colorFor(b.kt), 'stroke-width': 1.4, 'stroke-opacity': 0.9,
          'stroke-linecap': 'round',
        }));
      }
    }

    /* --- the cone edge, never touched by the environment ----------------
     * WIDTH AND EDGE CARRY "how sure we are WHERE". FILL CARRIES "why".
     * The edge keeps its own neutral colour so the shape still reads at a
     * glance even where the fill has fallen to nearly nothing. */
    let path = `M ${pts[0].lx} ${pts[0].ly}`;
    for (let i = 1; i < pts.length; i++) path += ` L ${pts[i].lx} ${pts[i].ly}`;
    path += ` A ${end.r} ${end.r} 0 0 1 ${end.rx} ${end.ry}`;
    for (let i = pts.length - 2; i >= 0; i--) path += ` L ${pts[i].rx} ${pts[i].ry}`;
    scene.appendChild(el('path', {
      d: path + ' Z', fill: 'none', stroke: 'var(--cone-edge)',
      'stroke-width': 1, 'stroke-opacity': 0.45, 'stroke-linejoin': 'round',
    }));
  }

  const [hx, hy] = p(d.lonW[0], d.lat[0]);
  scene.appendChild(el('path', {
    d: `M ${hx + 58} ${hy + 16} L ${hx + 29} ${hy + 7} L ${hx} ${hy}`,
    stroke: 'var(--track-past)', 'stroke-width': 1.6,
    'stroke-dasharray': '2 4', 'stroke-linecap': 'round', fill: 'none',
  }));

  /* --- the bright core: the forecast track itself ----------------------- */
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    scene.appendChild(el('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: state.env ? colorFor((a.kt + b.kt) / 2) : 'var(--track-fc)',
      'stroke-width': state.env ? 2.6 : 1.75, 'stroke-linecap': 'round',
    }));
  }

  /* --- forecast points, category-coloured, as the app draws them -------- */
  const code = (kt) => (kt >= 64 ? 'H' : kt >= 34 ? 'S' : 'D');
  for (let i = 0; i < d.hrs.length; i++) {
    const [x, y] = p(d.lonW[i], d.lat[i]);
    const v = d.v[i];
    scene.appendChild(el('circle', {
      cx: x, cy: y, r: i === 0 ? 8.5 : 6,
      fill: (d.id.startsWith('AL94') && i === 0) ? 'var(--pregenesis)'
        : v >= 34 ? 'var(--cat-ts)' : 'var(--cat-td)',
      stroke: '#0B1420', 'stroke-width': 1.4,
    }));
    const t = el('text', {
      x, y: y + (i === 0 ? 4 : 3.2), 'text-anchor': 'middle',
      'font-size': i === 0 ? 11 : 8.5, 'font-weight': 700, fill: '#0B1420',
    });
    t.textContent = code(v);
    scene.appendChild(t);
  }

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
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

function drawDrawer(d) {
  const lastHr = d.hrs[d.hrs.length - 1];
  const i = colIndex(d, lastHr);
  if (i < 0) return;
  const kt = envKtAt(d, i);
  const self = selfKtAt(d, i);
  const agree = agreementAt(d, i);
  const terms = envTermsAt(d, i);

  const ranked = Object.entries(terms)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const helper = ranked.find(([, v]) => v > 0);
  const hurter = ranked.find(([, v]) => v < 0);

  const agreeWord = agree >= ENV_KT.agreeStrong ? 'and nearly everything agrees'
    : agree >= ENV_KT.agreeWeak ? 'though not everything agrees'
    : 'but the factors are fighting each other';

  let line = `By <b>${hrLabel(lastHr)}</b> the air and water around it are worth `
    + `<b>${signed(kt)} kt</b> — ${bandFor(kt).label.toLowerCase()}, ${agreeWord}.`;
  if (helper && hurter) {
    line += ` ${ENV_TERMS[helper[0]]} is worth ${signed(helper[1])}, `
      + `${ENV_TERMS[hurter[0]].toLowerCase()} ${signed(hurter[1])}.`;
  }
  document.getElementById('verdict').innerHTML = line;

  document.getElementById('figs').innerHTML = ranked.slice(0, 4).map(([k, v]) => `
    <div class="fig"><span class="k">${ENV_TERMS[k]}</span>
      <span class="v">${signed(v)} kt</span></div>`).join('');

  /* The storm's own structure is shown but never coloured. It is the reason
     Hernan dies in a perfectly reasonable environment, and hiding it would
     make the ribbon look like it was explaining the forecast when it isn't. */
  document.getElementById('note').textContent =
    `Its own structure is worth ${signed(self)} kt on top of that — not part of `
    + `the colour. ${d.tail}`;
}

function drawLegend() {
  const r = RAMPS[state.ramp];
  const host = document.getElementById('legend-bar');
  const ends = document.getElementById('legend-ends');
  if (state.detail === 'steps') {
    host.className = 'swatches';
    host.style.background = 'none';
    host.innerHTML = ENV_KT.bands.map((b) => `
      <div class="swatch"><i style="background:${mix(r.stops, b.t)}"></i>
        <span>${b.label}</span></div>`).join('');
    ends.style.display = 'none';
  } else {
    host.className = 'bar';
    host.innerHTML = '';
    const stops = [];
    for (let i = 0; i <= 20; i++) stops.push(mix(r.stops, i / 20));
    host.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
    ends.style.display = 'flex';
  }
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
buildSegs('pick-detail', [['steps', '5 steps'], ['smooth', 'Smooth']], 'detail');
buildSegs('pick-alpha', [['subtle', 'Subtle'], ['medium', 'Medium'], ['bold', 'Bold']], 'alpha');

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
bindRow('row-env', 'env', 'What the air and water are worth', 'Off — plain white cone');
bindRow('row-cone', 'cone', 'Where it might go', 'Off — track only');

draw();
