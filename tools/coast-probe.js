/**
 * coast-probe.js — THE MEASUREMENT BEHIND `tools/coast-probe.html`.
 *
 * ==> IT DRIVES `map/coast-source.js`, NOT A COPY OF IT. <== A probe that
 * builds its own `querySourceFeatures` call is measuring a lookalike, and the
 * whole reason this file exists is that two shoreline cuts were built against
 * an imagined version of this data and both failed on glass. So the source is
 * declared exactly as `map/style.js` declares it — same name, same URL, driven
 * by the same `TILES` constants — and the rings come back through the same
 * function the app calls.
 *
 * ==> IT IS A SEPARATE FILE BECAUSE THE CSP IS ENFORCED. <== `script-src` has
 * no 'unsafe-inline', so an inline module in the HTML would be blocked and the
 * page would render as buttons that do nothing.
 *
 * Reads nothing, writes nothing, ships in no bundle. `maplibregl` is expected
 * on `window` — the HTML loads the vendored build before this module.
 */

import { TILES } from '../config/constants.js';
import { coastRings, coastGeneration } from '../map/coast-source.js';

/** Metres per degree of latitude. Spherical earth; the error is far below one
 *  point gap at any of these scales. Same constant as the water builder. */
const M_PER_DEG_LAT = 111320;

/** How long the map has to stay quiet before the report is trusted. `idle` can
 *  fire while the last tiles are still decoding on a slow connection, and a
 *  report taken then under-counts rings — which is the one way this tool could
 *  mislead in the same direction as the bugs it exists to prevent. */
const SETTLE_MS = 1200;

/** The three seamounts whose seas actually reach a coast, plus one open-ocean
 *  control. The control matters: without it, "no rings" cannot be told apart
 *  from "the query failed". */
const PLACES = [
  { id: 'kuwae', label: 'Kuwae (Vanuatu)', lon: 168.52, lat: -16.83, zoom: 8 },
  { id: 'kavachi', label: 'Kavachi (Solomons)', lon: 157.98, lat: -8.99, zoom: 8 },
  { id: 'palinuro', label: 'Palinuro (Italy)', lon: 14.83, lat: 39.48, zoom: 8 },
  { id: 'vailulu', label: 'Vailulu\u2019u (open-ocean control)', lon: -169.06, lat: -14.22, zoom: 8 },
];

const out = document.getElementById('out');
const nav = document.getElementById('places');
let current = PLACES[0];

const map = new window.maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    /* Declared exactly as map/style.js declares it, INCLUDING THE NAME, because
     * coast-source.js queries the source called `basemap` and nothing else. */
    sources: TILES.useR2
      ? { basemap: { type: 'vector', tiles: [TILES.tilesUrl], maxzoom: TILES.sourceMaxzoom } }
      : { basemap: { type: 'vector', url: TILES.openFreeMapStyle } },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b0f14' } }],
  },
  center: [current.lon, current.lat],
  zoom: current.zoom,
  attributionControl: false,
});

/* ---- the measurements ---------------------------------------------------- */

/** Twice the signed area of a ring. Only the SIGN is used — it is the winding
 *  direction, which is the thing an even-odd ray cast depends on and a fill
 *  does not. */
function signedArea2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a;
}

function isClosed(ring) {
  const a = ring[0];
  const b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

/** Metres between two lon/lat points, flat about their mean latitude. */
function gapM(p, q) {
  const midLat = (p[1] + q[1]) / 2;
  let dLon = q[0] - p[0];
  if (dLon > 180) dLon -= 360;
  else if (dLon < -180) dLon += 360;
  return Math.hypot(
    dLon * M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180),
    (q[1] - p[1]) * M_PER_DEG_LAT
  );
}

function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function report() {
  const zoom = map.getZoom();
  const gen = coastGeneration(map);
  const res = coastRings(map);

  const L = [];
  const say = (s) => L.push(s);

  say(`PLACE      ${current.label}  (${current.lon}, ${current.lat})`);
  say(`ZOOM       ${zoom.toFixed(2)}   ·   coast generation ${gen}`);
  say(`useR2      ${TILES.useR2}`);
  say('');

  if (!res.schema) {
    say('SCHEMA     nothing answered.');
    say('');
    say('That is the honest "no substrate" state, not an empty coastline.');
    say('Either the tiles have not loaded, or neither schema has a coast');
    say('layer here. Wait a moment, or pan slightly and let it settle again.');
    out.textContent = L.join('\n');
    return;
  }

  say(`SCHEMA     ${res.schema}`);
  say(`RINGS      ${res.rings.length}`);
  say(`POINTS     ${res.vertexCount}`);
  say('');

  /* ---- closure and winding: what a ray cast would need and a fill would not */
  let closed = 0;
  let cw = 0;
  let ccw = 0;
  let degenerate = 0;
  for (const r of res.rings) {
    if (r.length < 3) {
      degenerate++;
      continue;
    }
    if (isClosed(r)) closed++;
    const a = signedArea2(r);
    if (a > 0) cw++;
    else if (a < 0) ccw++;
    else degenerate++;
  }
  say(
    `CLOSED     ${closed} of ${res.rings.length} rings are closed loops` +
      (closed === res.rings.length ? '   <- all of them' : '   <- NOT all of them')
  );
  say(
    `WINDING    ${cw} clockwise, ${ccw} counter-clockwise` +
      (cw === 0 || ccw === 0 ? '   <- consistent' : '   <- MIXED')
  );
  if (degenerate) say(`DEGENERATE ${degenerate} ring(s) with no area`);
  say('');

  /* ---- point spacing: the real resolution of this coastline --------------- */
  const gaps = [];
  for (const r of res.rings) {
    for (let i = 1; i < r.length; i++) gaps.push(gapM(r[i - 1], r[i]));
  }
  gaps.sort((a, b) => a - b);
  say('SPACING    between neighbouring points, in metres');
  say(
    `           p10 ${quantile(gaps, 0.1).toFixed(0)}` +
      `   median ${quantile(gaps, 0.5).toFixed(0)}` +
      `   p90 ${quantile(gaps, 0.9).toFixed(0)}` +
      `   max ${(gaps[gaps.length - 1] || 0).toFixed(0)}`
  );
  say('           for comparison map/coastline.js is a 63,000 m median,');
  say('           which is why it cannot cut a shoreline.');
  say('');

  /* ---- duplication across tiles: the even-odd killer ---------------------- */
  const seen = new Map();
  let dupPoints = 0;
  for (const r of res.rings) {
    for (const p of r) {
      const k = p[0].toFixed(6) + ',' + p[1].toFixed(6);
      const c = (seen.get(k) || 0) + 1;
      seen.set(k, c);
      if (c === 2) dupPoints++;
    }
  }
  say(`DUPLICATES ${dupPoints} point positions arrive more than once,`);
  say(`           out of ${seen.size} distinct positions in ${res.vertexCount} points.`);
  if (dupPoints > 0) say('           <- this is the even-odd cancellation. A fill does not care.');
  say('');

  /* ---- how far past a tile edge does geometry reach ----------------------- */
  const tileSpanDeg = 360 / Math.pow(2, Math.floor(zoom));
  let wide = 0;
  let worst = 0;
  for (const r of res.rings) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of r) {
      if (p[0] < lo) lo = p[0];
      if (p[0] > hi) hi = p[0];
    }
    const w = hi - lo;
    if (w > tileSpanDeg) {
      wide++;
      worst = Math.max(worst, w / tileSpanDeg);
    }
  }
  say(`TILE SPAN  one tile is ${tileSpanDeg.toFixed(4)}° of longitude at z${Math.floor(zoom)}`);
  say(
    `BUFFER     ${wide} ring(s) span more than one tile's width` +
      (wide ? `, worst ${worst.toFixed(2)}x` : '')
  );
  say('');

  /* ---- the two lines a mask is actually built from ------------------------ */
  say('WHAT THIS MEANS FOR THE MASK');
  say(
    res.schema === 'openmaptiles'
      ? '  POLARITY: these rings are the OCEAN. Filling them paints WATER.'
      : '  POLARITY: these rings are the LAND. Filling them paints LAND.'
  );
  say(
    dupPoints > 0 || (cw > 0 && ccw > 0)
      ? '  A FILL IS REQUIRED. This geometry is not clean enough for a ray cast.'
      : '  Clean enough that a ray cast could work — a fill is still cheaper.'
  );

  out.textContent = L.join('\n');
}

/* ---- wiring -------------------------------------------------------------- */

let settleTimer = null;
function scheduleReport() {
  out.textContent = 'loading tiles…';
  clearTimeout(settleTimer);
  settleTimer = setTimeout(report, SETTLE_MS);
}

map.on('idle', scheduleReport);
map.on('error', (e) => {
  /* Loud and in plain language. A probe that fails quietly is worse than none. */
  out.textContent = 'MAP ERROR\n\n' + (e && e.error ? e.error.message : String(e));
});

for (const p of PLACES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = p.label;
  b.setAttribute('aria-pressed', String(p.id === current.id));
  b.addEventListener('click', () => {
    current = p;
    for (const other of nav.children) other.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-pressed', 'true');
    out.textContent = 'moving…';
    map.jumpTo({ center: [p.lon, p.lat], zoom: p.zoom });
  });
  nav.appendChild(b);
}
