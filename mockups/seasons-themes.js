/**
 * seasons-themes.js — the logic for mockups/seasons-themes.html.
 *
 * ==> IT IS A SEPARATE FILE BECAUSE OF THE CSP, NOT BECAUSE OF TIDINESS. <==
 *
 * `_headers` sets `script-src 'self' … 'sha256-…'`. An inline <script> in a
 * mockup matches neither, so the browser refuses to run it — and because the
 * theme is applied by setting `data-theme` on <html>, a blocked script means
 * every custom property is undefined and the page renders as unstyled black
 * text on white. That is exactly what shipped on the first attempt.
 *
 * Anything added to a mockup from here on: markup and <style> can be inline,
 * script cannot.
 *
 * NOT APPLICATION CODE. Imports nothing, imported by nothing.
 */

/* ---------------------------------------------------------------- theme --- */
const root = document.documentElement;

function setTheme(name) {
  root.dataset.theme = name;
  document.querySelectorAll('[data-t]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.t === name)));
  draw();
}
document.querySelectorAll('[data-t]').forEach((b) => {
  b.addEventListener('click', () => setTheme(b.dataset.t));
});

document.querySelectorAll('[data-s]').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.screen').forEach((s) =>
      s.classList.toggle('on', s.id === b.dataset.s));
    document.querySelectorAll('[data-s]').forEach((o) =>
      o.setAttribute('aria-pressed', String(o === b)));
  });
});

/* --------------------------------------------------------- roster demo --- */
document.querySelectorAll('.item[data-on]').forEach((el) => {
  el.addEventListener('click', () => {
    const on = el.dataset.on === '1';
    el.dataset.on = on ? '0' : '1';
    el.querySelector('.box').textContent = on ? '' : '✓';
  });
});

document.querySelectorAll('.filters .f').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.filters .f').forEach((o) =>
      o.setAttribute('aria-pressed', String(o === b)));
    document.getElementById('radius')
      .classList.toggle('on', b.id === 'f-home');
  });
});

const rr = document.getElementById('rr');
if (rr) {
  rr.addEventListener('input', () => {
    document.getElementById('rv').textContent = `${rr.value} mi`;
    /* Illustrative only — a real count comes from the track data. */
    const n = Math.max(0, Math.round((rr.value - 40) / 55));
    document.getElementById('rcount').textContent =
      n === 1 ? '1 storm this season passed' : `${n} storms this season passed`;
  });
}

/* ------------------------------------------------------ download demo --- */
let p = 0;
setInterval(() => {
  p = p >= 100 ? 0 : p + 1;
  const fill = document.getElementById('fill');
  if (!fill) return;
  fill.style.transform = `scaleX(${p / 100})`;
  document.getElementById('pct').textContent = `${p}%`;
  document.getElementById('mb').textContent = `${(6.8 * p / 100).toFixed(1)} of 6.8 MB`;
}, 90);

/* --------------------------------------------------------------- globe ---
 * Plain orthographic projection. Anything on the far side of the sphere is
 * dropped. Coastlines are coarse BY DESIGN — this is a paint chip, not a map,
 * and the only question it answers is which ground survives the fixed
 * Saffir-Simpson ramp.                                                      */
const R = 178, CX = 200, CY = 200, CLON = -68, CLAT = 24;
const rad = Math.PI / 180;

function proj(lon, lat) {
  const p1 = lat * rad, l = (lon - CLON) * rad, p0 = CLAT * rad;
  const cosc = Math.sin(p0) * Math.sin(p1) + Math.cos(p0) * Math.cos(p1) * Math.cos(l);
  if (cosc < 0) return null;
  return [CX + R * Math.cos(p1) * Math.sin(l),
          CY - R * (Math.cos(p0) * Math.sin(p1) - Math.sin(p0) * Math.cos(p1) * Math.cos(l))];
}

function path(pts, close) {
  let d = '', pen = false;
  for (const [lon, lat] of pts) {
    const q = proj(lon, lat);
    if (!q) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)} `;
    pen = true;
  }
  return d ? d + (close ? 'Z' : '') : '';
}

/* Coast points are real-ish; inland closures are not, and do not need to be —
 * they sit off the visible face or under other land. */
const NA = [[-88.6,15.9],[-88.2,17.5],[-87.8,18.5],[-87.0,20.2],[-87.5,21.5],
  [-89.0,21.6],[-90.3,21.1],[-90.5,19.9],[-92.0,18.6],[-94.4,18.2],[-96.1,19.2],
  [-97.4,21.5],[-97.7,24.0],[-97.4,26.0],[-97.2,27.5],[-96.4,28.4],[-94.8,29.3],
  [-93.3,29.7],[-91.2,29.2],[-89.4,29.0],[-88.0,30.2],[-86.5,30.4],[-84.9,29.7],
  [-83.7,29.2],[-82.7,27.9],[-82.0,26.5],[-81.1,25.1],[-80.1,26.1],[-80.6,28.1],
  [-81.4,30.3],[-81.3,31.1],[-79.9,32.8],[-77.9,34.0],[-75.5,35.2],[-76.3,37.0],
  [-74.0,39.5],[-71.0,41.3],[-70.0,42.0],[-67.0,44.5],[-64.0,45.5],[-60.0,46.5],
  [-55.5,49.5],[-60.0,52.0],[-70.0,53.0],[-85.0,52.0],[-100.0,50.0],[-110.0,40.0],
  [-107.0,30.0],[-99.0,22.0],[-94.0,17.0],[-91.0,15.0]];
const SA = [[-77.5,8.0],[-75.5,9.5],[-71.5,12.4],[-68.0,10.6],[-64.0,10.6],
  [-61.5,10.7],[-59.0,8.4],[-52.0,4.5],[-50.0,0.5],[-58.0,-6.0],[-70.0,-4.0],
  [-78.0,0.0],[-79.0,7.0]];
const CUBA = [[-84.9,21.9],[-82.5,23.2],[-80.5,23.1],[-78.5,22.4],[-77.0,21.2],
  [-75.6,20.8],[-74.1,20.2],[-75.1,19.9],[-77.3,19.9],[-79.5,21.0],[-82.0,22.4]];
const HISP = [[-73.9,19.9],[-71.7,19.9],[-69.9,19.3],[-68.4,18.6],[-70.0,18.2],
  [-71.6,18.4],[-73.5,18.2],[-74.4,18.6]];
const PR = [[-67.2,18.5],[-65.6,18.4],[-65.7,17.9],[-67.2,17.9]];
const JAM = [[-78.4,18.5],[-76.2,18.4],[-76.3,17.8],[-78.3,18.0]];
const LAND = [NA, SA, CUBA, HISP, PR, JAM];

/* One storm, carrying every category, coming ashore at the delta. */
const TRACK = [
  [-45.0,13.0,'td'],[-47.5,13.5,'ts'],[-50.0,14.0,'ts'],[-52.5,14.5,'ts'],
  [-55.0,15.0,'c1'],[-57.5,15.6,'c1'],[-60.0,16.2,'c2'],[-62.5,16.9,'c2'],
  [-65.0,17.6,'c3'],[-67.5,18.3,'c3'],[-70.0,19.1,'c4'],[-72.5,19.9,'c4'],
  [-75.0,20.7,'c5'],[-77.5,21.5,'c5'],[-80.0,22.4,'c4'],[-82.5,23.3,'c3'],
  [-85.0,24.6,'c3'],[-86.5,26.1,'c4'],[-88.0,27.6,'c5'],[-89.4,29.0,'c4','L'],
  [-90.5,30.6,'c1'],[-91.0,32.2,'ts'],[-90.4,34.2,'td'],
];

function css(v) {
  return getComputedStyle(root).getPropertyValue(v).trim();
}

/**
 * FRAME THE STORM, NOT THE HEMISPHERE.
 *
 * The first cut drew the whole visible face at 400x400 and the track came out
 * a third of the disc wide — technically what the app shows at world zoom, and
 * useless for the one job this page has, which is judging a ground colour
 * against the dots sitting on it. This windows the viewBox onto the track's
 * own bounding box with enough padding that the limb still curves through a
 * corner, so it still reads as a planet.
 *
 * `k` is how much that window scales everything up. Every stroke width and dot
 * radius below is divided by it, or a 2.5x zoom would draw 2.5x fatter dots.
 */
function frame() {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [lon, lat] of TRACK) {
    const q = proj(lon, lat);
    if (!q) continue;
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]);
    y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
  }
  const padX = (x1 - x0) * 0.26, padY = (y1 - y0) * 1.05;
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const w = x1 - x0, h = y1 - y0;
  return { vb: `${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`,
           k: w / 400 };
}

function draw() {
  const svg = document.getElementById('globe');
  if (!svg) return;

  const { vb, k } = frame();
  svg.setAttribute('viewBox', vb);

  const ocean = css('--ocean'), deep = css('--ocean-deep');
  const coast = css('--coast'), ink = css('--ink');
  const g = [];

  g.push(`<defs>
    <radialGradient id="sea" cx="38%" cy="32%" r="78%">
      <stop offset="0%" stop-color="${ocean}"/>
      <stop offset="72%" stop-color="${ocean}"/>
      <stop offset="100%" stop-color="${deep}"/>
    </radialGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.4"/></filter>
    <filter id="rim" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="5"/></filter>
  </defs>`);

  g.push(`<circle cx="${CX}" cy="${CY}" r="${R + 3}" fill="none" stroke="${coast}"
     stroke-width="${(4*k).toFixed(2)}" opacity=".16" filter="url(#rim)"/>`);
  g.push(`<circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#sea)"/>`);

  /* graticule — the three reference lines plus a few meridians */
  const grat = [];
  for (const lat of [0, 23.4, -23.4]) {
    const row = [];
    for (let lon = -180; lon <= 180; lon += 2) row.push([lon, lat]);
    grat.push(path(row));
  }
  for (let lon = -120; lon <= 0; lon += 20) {
    const col = [];
    for (let lat = -80; lat <= 80; lat += 2) col.push([lon, lat]);
    grat.push(path(col));
  }
  g.push(`<g stroke="${css('--grat')}" fill="none" stroke-width="${(0.7*k).toFixed(2)}" opacity=".38">
    ${grat.map((d) => `<path d="${d}"/>`).join('')}</g>`);

  /* the cage — the thing that has to say "not live" without touching a dot */
  const mesh = [];
  for (let lat = -60; lat <= 60; lat += 5) {
    const row = [];
    for (let lon = -180; lon <= 180; lon += 1.5) row.push([lon, lat]);
    mesh.push(path(row));
  }
  for (let lon = -180; lon <= 180; lon += 5) {
    const col = [];
    for (let lat = -70; lat <= 70; lat += 1.5) col.push([lon, lat]);
    mesh.push(path(col));
  }
  g.push(`<g stroke="${css('--mesh')}" fill="none" stroke-width="${(0.55*k).toFixed(2)}" opacity=".55">
    ${mesh.map((d) => `<path d="${d}"/>`).join('')}</g>`);

  /* land: fill, glow, line */
  g.push(`<g fill="${css('--land')}" stroke="none">
    ${LAND.map((s) => `<path d="${path(s, true)}"/>`).join('')}</g>`);
  g.push(`<g fill="none" stroke="${coast}" stroke-width="${(1.1*k).toFixed(2)}" opacity=".30"
     filter="url(#soft)">
    ${LAND.map((s) => `<path d="${path(s, true)}"/>`).join('')}</g>`);
  g.push(`<g fill="none" stroke="${coast}" stroke-width="${(0.8*k).toFixed(2)}" opacity=".85">
    ${LAND.map((s) => `<path d="${path(s, true)}"/>`).join('')}</g>`);

  /* track line, then dots on top */
  g.push(`<path d="${path(TRACK.map((t) => [t[0], t[1]]))}" fill="none"
     stroke="${css('--track')}" stroke-width="${(1.6*k).toFixed(2)}"
     stroke-dasharray="${(1*k).toFixed(2)} ${(4*k).toFixed(2)}"
     stroke-linecap="round"/>`);

  const dots = [];
  for (const [lon, lat, cat, mark] of TRACK) {
    const q = proj(lon, lat);
    if (!q) continue;
    const c = css(`--${cat}`);
    const x = q[0].toFixed(1), y = q[1].toFixed(1);
    dots.push(`<circle cx="${x}" cy="${y}" r="${(7*k).toFixed(2)}" fill="${c}" opacity=".22"
       filter="url(#soft)"/>`);
    dots.push(`<circle cx="${x}" cy="${y}" r="${(3.6*k).toFixed(2)}" fill="${c}" stroke="${deep}"
       stroke-width="${(0.8*k).toFixed(2)}"/>`);
    if (mark === 'L') {
      dots.push(`<circle cx="${x}" cy="${y}" r="${(9.5*k).toFixed(2)}" fill="none" stroke="${ink}"
         stroke-width="${(1.6*k).toFixed(2)}" opacity=".9"/>`);
      dots.push(`<circle cx="${x}" cy="${y}" r="${(13.5*k).toFixed(2)}" fill="none" stroke="${ink}"
         stroke-width="${(0.7*k).toFixed(2)}" opacity=".45"/>`);
    }
  }
  g.push(dots.join(''));

  const head = proj(-88.0, 27.6);
  if (head) {
    g.push(`<text x="${(head[0] + 14*k).toFixed(1)}" y="${(head[1] - 9*k).toFixed(1)}"
       fill="${ink}" font-size="${(11*k).toFixed(2)}" font-weight="600"
       font-family="system-ui" letter-spacing=".02em" stroke="${deep}"
       stroke-width="${(2.6*k).toFixed(2)}" paint-order="stroke">KATRINA · 2005</text>`);
  }

  svg.innerHTML = g.join('');
}

/* Start on the live theme so the first frame is the app as it exists today —
 * the reference every candidate is judged against. */
setTheme('live');
