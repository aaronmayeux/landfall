/**
 * imagery-probe.js — the probe's script, in its own file BECAUSE OF THE CSP.
 *
 * ==> IT USED TO BE AN INLINE <script> AND THAT MADE IT DEAD ON THE DEPLOYED
 * SITE. <== `_headers` sends a real, enforcing Content-Security-Policy and
 * `script-src` has no `'unsafe-inline'`, so the browser refused to run it: the
 * page loaded, looked fine, and every control did nothing. A probe that lies
 * about the thing it exists to measure is worse than no probe.
 *
 * `tools/coast-probe.js` already had the answer -- an external file is allowed.
 * Nothing here changed but its address.
 *
 * NOTE FOR WHOEVER ADDS THE NEXT PROBE: `tools/csp-check.mjs` does not look at
 * `tools/` at all, so it will not catch this for you. Never inline a script here.
 */

const R = 20037508.342789244;
const mx = (lon) => (lon * R) / 180;
const my = (lat) => (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (R / 180);
const bbox = (w, s, e, n) => [mx(w), my(s), mx(e), my(n)].join(',');

/* Storm-disc sized boxes, one per satellite region — testing at the size we
   will actually draw, not at hemisphere scale. */
const BOX = {
  atlantic: bbox(-65, 15, -55, 25),
  epac:     bbox(-125, 12, -115, 22),
  wpac:     bbox(130, 10, 140, 20),
  indian:   bbox(60, 8, 70, 18),
};

function gibsTime(minutesBack) {
  const t = new Date(Date.now() - minutesBack * 60000);
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 10) * 10);
  return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function url(base, params) {
  const u = new URL(base);
  for (const k in params) u.searchParams.set(k, params[k]);
  return u.toString();
}

const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
const EUM  = 'https://view.eumetsat.int/geoserver/ows';
const IEM  = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/';

const gibs = (layer, box, back) => url(GIBS, {
  SERVICE:'WMS', VERSION:'1.1.1', REQUEST:'GetMap', LAYERS:layer,
  SRS:'EPSG:3857', BBOX:box, WIDTH:512, HEIGHT:512,
  FORMAT:'image/png', TRANSPARENT:'true', TIME:gibsTime(back),
});
const iem = (host, layer, box) => url(IEM + host + '.cgi', {
  service:'WMS', version:'1.1.1', request:'GetMap', layers:layer,
  srs:'EPSG:3857', bbox:box, width:512, height:512,
  format:'image/png', transparent:'true', styles:'',
});
const eum = (layer, box) => url(EUM, {
  service:'WMS', version:'1.3.0', request:'GetMap', layers:layer,
  crs:'EPSG:3857', bbox:box, width:512, height:512,
  format:'image/png', transparent:'true', styles:'',
});

/* Same as gibs(), but with NO TIME parameter — asking the server for its own
   default frame. If the default IS the newest usable one, the app never has to
   carry a lag constant per satellite, and a constant we do not have to tune is
   a constant that cannot go stale. */
const gibsDefault = (layer, box) => url(GIBS, {
  SERVICE:'WMS', VERSION:'1.1.1', REQUEST:'GetMap', LAYERS:layer,
  SRS:'EPSG:3857', BBOX:box, WIDTH:512, HEIGHT:512,
  FORMAT:'image/png', TRANSPARENT:'true',
});

/* THE LAG LADDER. The 60-minute GOES-West frame came back completely empty
   while the 180-minute one was fine, so "how far behind is each bird" is a
   measured number, not a guess. Walk backwards until content appears. */
const LADDER = [0, 20, 40, 60, 90, 120, 180];
const SATS = [
  ['GOES-East', 'GOES-East_ABI_Band13_Clean_Infrared', BOX.atlantic],
  ['GOES-West', 'GOES-West_ABI_Band13_Clean_Infrared', BOX.epac],
  ['Himawari',  'Himawari_AHI_Band13_Clean_Infrared',  BOX.wpac],
];

const TARGETS = [
  ...SATS.map(([name, layer, box]) => [`GIBS ${name} DEFAULT (no TIME)`, gibsDefault(layer, box)]),
  ...SATS.flatMap(([name, layer, box]) =>
    LADDER.map((back) => [`GIBS ${name} -${String(back).padStart(3)}m`, gibs(layer, box, back)])),
  ['EUM msg_iodc ir108   (Indian, default)', eum('msg_iodc:ir108', BOX.indian)],
  ['EUM msg_iodc ir108   (S Indian)',        eum('msg_iodc:ir108', bbox(55, -20, 65, -10))],
  /* Seam checks — the two places the satellite lookup has to hand off. */
  ['GIBS GOES-West (dateline W)', gibsDefault('GOES-West_ABI_Band13_Clean_Infrared', bbox(175, 10, -175 + 360, 20))],
  ['GIBS Himawari  (dateline E)', gibsDefault('Himawari_AHI_Band13_Clean_Infrared',  bbox(175, 10, -175 + 360, 20))],
  ['GIBS Himawari  (E Indian)',   gibsDefault('Himawari_AHI_Band13_Clean_Infrared',  bbox(95, -18, 105, -8))],
  ['EUM msg_iodc   (E Indian)',   eum('msg_iodc:ir108', bbox(95, -18, 105, -8))],
];

function stats(data) {
  const n = data.length / 4;
  const sats = new Uint8Array(n);
  let satSum = 0, lumMin = 255, lumMax = 0, opaque = 0, clear = 0, colored = 0;
  const swatch = [];
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    if (a === 0) { clear++; sats[p] = 0; continue; }
    if (a === 255) opaque++;
    const hi = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const lo = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const s = hi - lo;
    sats[p] = s;
    satSum += s;
    if (s > 20) colored++;
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    if (lum < lumMin) lumMin = lum;
    if (lum > lumMax) lumMax = lum;
    if (swatch.length < 6 && p % 7919 === 0) swatch.push(`${r},${g},${b},${a}`);
  }
  const visible = n - clear;
  const sorted = Array.from(sats).sort((a, b) => a - b);
  return {
    px: n,
    transparentPct: +(100 * clear / n).toFixed(1),
    opaquePct: +(100 * opaque / n).toFixed(1),
    meanSat: visible ? +(satSum / visible).toFixed(2) : 0,
    p99Sat: sorted[Math.floor(n * 0.99)],
    maxSat: sorted[n - 1],
    coloredPxPct: +(100 * colored / n).toFixed(1),
    lum: `${Math.round(lumMin)}..${Math.round(lumMax)}`,
    swatch,
  };
}

const cv = document.createElement('canvas');
cv.width = 512; cv.height = 512;
const ctx = cv.getContext('2d', { willReadFrequently: true });

async function measure(label, u) {
  const t0 = performance.now();
  try {
    const r = await fetch(u, { mode: 'cors' });
    const blob = await r.blob();
    const bmp = await createImageBitmap(blob);
    ctx.clearRect(0, 0, 512, 512);
    ctx.drawImage(bmp, 0, 0, 512, 512);
    const s = stats(ctx.getImageData(0, 0, 512, 512).data);
    return { label, ms: Math.round(performance.now() - t0), bytes: blob.size, ...s };
  } catch (e) {
    return { label, error: String(e && e.message || e) };
  }
}

(async () => {
  const rows = [];
  for (const [label, u] of TARGETS) rows.push(await measure(label, u));
  const verdict = rows.map((r) => {
    if (r.error) return `${r.label}  ERROR ${r.error}`;
    const kind = r.meanSat < 3 ? 'GREYSCALE' : r.meanSat < 12 ? 'near-grey' : 'COLOURED';
    /* The only question the lag ladder asks: did anything come back at all?
     * An all-black opaque frame and a fully transparent one are both EMPTY —
     * distinguishing them from real imagery is the whole point. */
    const empty = (r.lum === '0..0') || (r.transparentPct > 99) || (r.bytes < 5000);
    return [
      r.label.padEnd(38),
      (empty ? '*** EMPTY' : 'has-data').padEnd(10),
      kind.padEnd(10),
      `meanSat=${String(r.meanSat).padStart(6)}`,
      `p99=${String(r.p99Sat).padStart(3)}`,
      `max=${String(r.maxSat).padStart(3)}`,
      `colouredPx=${String(r.coloredPxPct).padStart(5)}%`,
      `transparent=${String(r.transparentPct).padStart(5)}%`,
      `lum=${r.lum}`,
      `${(r.bytes/1024).toFixed(0)}kB`,
      `${r.ms}ms`,
    ].join('  ');
  }).join('\n');
  document.getElementById('out').textContent =
    verdict + '\n\n--- raw ---\n' + JSON.stringify(rows, null, 1);
})();
