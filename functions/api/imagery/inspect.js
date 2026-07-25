/**
 * /api/imagery/inspect — READ-ONLY probe of every candidate imagery vendor.
 *
 * WHY THIS EXISTS. Same reason as its two siblings (functions/api/nhc/inspect.js
 * and functions/api/gdacs/inspect.js): the cloud sandbox Andy works in cannot
 * reach any of these hosts — its egress proxy allowlists github.com and the
 * package registries and 403s everything else. The DEPLOYED SITE can reach
 * them. So it fetches on request and reports what actually came back.
 *
 * WHAT IT IS FOR, specifically. SPEC §4's imagery block is entirely INHERITED
 * from the HA project and both of its endpoints still carry [VERIFY] markers.
 * Worse, that block assumes ONE satellite (GOES-East), and Phase 7 now has to
 * cover the whole globe — the West Pacific and Indian Ocean basins are not in
 * GOES-East's disk at all. Five geostationary satellites see the whole tropical
 * belt; no single vendor serves all five in one product.
 *
 * THE QUESTION THIS ROUTE ANSWERS, and it is the one that decides the design:
 * is the clean-longwave-IR product each vendor serves COLOR-ENHANCED or
 * GRAYSCALE?
 *   - Color-enhanced → the inherited saturation key applies (§4).
 *   - Grayscale → the saturation key erases the whole image, because grayscale
 *     has no chroma to key on. That path needs a client-side color ramp
 *     instead, which is not a downgrade: one palette we own, applied
 *     identically to every vendor, is the only way five satellites read as one
 *     layer.
 * Nothing gets built until this route says which.
 *
 * SAFE TO LEAVE DEPLOYED. It:
 *   - only ever GETs from a FIXED list of hardcoded public URLs,
 *   - takes NO parameters at all — it cannot be pointed anywhere else,
 *   - writes nothing, needs no secret,
 *   - returns metadata, header values, and truncated name lists — never bulk
 *     imagery.
 *
 * NO QUERY STRING BY DESIGN. Plain GET, one URL, everything in the response.
 * The browser tooling used to read this route filters query strings, and a
 * probe you cannot read is not a probe.
 *
 * USAGE:  /api/imagery/inspect
 */

/**
 * ==> STAGE 2: WHAT THE PIXELS ACTUALLY ARE <==
 *
 * The capabilities documents say WHICH channel each vendor serves. They do not
 * say whether the delivered image is grayscale brightness temperature or an
 * already-color-enhanced product, and that single fact decides the whole
 * pipeline (see the header note above). A Cloudflare Worker cannot decode a
 * PNG — but it does not have to. PNG states its own color model in the IHDR
 * chunk, 25 bytes in, in plain bytes:
 *
 *   colorType 0 = grayscale        3 = palette (check PLTE for a color ramp)
 *             2 = RGB              4 = gray + alpha        6 = RGBA
 *
 * Reading that header off a real GetMap request is a DIRECT MEASUREMENT of the
 * thing in question, not an inference from a product name.
 */

/** Per-probe timeout. A dead vendor must not hold the whole report hostage. */
const TIMEOUT_MS = 12_000;

/** Bytes of any capabilities document we are willing to scan. These run to
 *  several MB; we only need the layer names. */
const SCAN_LIMIT = 6_000_000;

/** Names worth reporting out of a capabilities document. Clean longwave IR is
 *  band 13 on ABI (GOES) and AHI (Himawari), channel IR 10.8 / IR_108 on
 *  SEVIRI (Meteosat). The point is to find the SAME physical channel on every
 *  satellite so one color treatment can serve all of them. */
const IR_HINT = /(band[_ ]?13|clean[_ ]?(long ?wave[_ ]?)?infrared|clean[_ ]?ir|ir[_ ]?10\.?8|ir108|ir_108|longwave|brightness[_ ]?temp)/i;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/* --- the candidate list ----------------------------------------------------
 * `kind` drives how the body is read:
 *   'caps'  — XML capabilities: extract <Name>/ows:Identifier, filter on IR_HINT
 *   'json'  — parse and report top-level shape
 *   'head'  — headers and byte count only (an actual image request)
 * ------------------------------------------------------------------------ */
const PROBES = [
  /* ---- IEM: the two GOES birds. The Americas, Atlantic, East Pacific. ---- */
  {
    id: 'iem-goes-east-caps',
    why: 'IEM GOES-East WMS — the inherited source, still [VERIFY] in SPEC §4',
    kind: 'caps',
    url: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/goes_east.cgi?service=WMS&version=1.1.1&request=GetCapabilities',
  },
  {
    id: 'iem-goes-west-caps',
    why: 'IEM GOES-West WMS — East Pacific and Central Pacific basins',
    kind: 'caps',
    url: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/goes_west.cgi?service=WMS&version=1.1.1&request=GetCapabilities',
  },

  /* ---- NASA GIBS: the one place that may carry ALL FIVE satellites in one
   * consistent product family. WMTS, EPSG:3857, no key, 10-minute cadence.
   * If this is real, it is the whole answer and the vendor count is ONE. ---- */
  {
    id: 'gibs-wmts-3857-caps',
    why: 'NASA GIBS WMTS (EPSG:3857) — may carry GOES-East/West, Himawari and Meteosat in one family',
    kind: 'caps',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml',
  },

  /* ---- RAMMB/CIRA SLIDER: GOES + Himawari + Meteosat, color-enhanced
   * products, but a bespoke tile scheme rather than a standard service. ---- */
  {
    id: 'slider-himawari-b13-times',
    why: 'RAMMB SLIDER — Himawari band 13 latest frame times (West Pacific)',
    kind: 'json',
    url: 'https://rammb-slider.cira.colostate.edu/data/json/himawari/full_disk/band_13/latest_times.json',
  },
  {
    id: 'slider-meteosat-times',
    why: 'RAMMB SLIDER — Meteosat (Indian Ocean / Atlantic) band listing',
    kind: 'json',
    url: 'https://rammb-slider.cira.colostate.edu/data/json/meteosat-9/full_disk/band_09/latest_times.json',
  },

  /* ---- EUMETSAT open view service: Meteosat 0-degree and IODC. ---- */
  {
    id: 'eumetsat-view-caps',
    why: 'EUMETSAT View WMS — Meteosat SEVIRI IR 10.8 (Africa, Indian Ocean, Europe)',
    kind: 'caps',
    url: 'https://view.eumetsat.int/geoserver/ows?service=WMS&version=1.3.0&request=GetCapabilities',
  },

  /* ---- Radar. Same host family as the MapServer that already passed. ---- */
  {
    id: 'nowcoast-radar-imageserver',
    why: 'NOAA MRMS base reflectivity ImageServer — SPEC §4 [VERIFY]',
    kind: 'json',
    url: 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer?f=json',
  },
  {
    id: 'nowcoast-legacy-host',
    why: 'The older nowcoast.noaa.gov host, in case the service did not move',
    kind: 'json',
    url: 'https://nowcoast.noaa.gov/arcgis/rest/services?f=json',
  },
];

/* --- stage 2: real image requests ------------------------------------------
 * Three sample boxes, one per satellite region, each roughly the size of the
 * per-storm disc Phase 7 actually draws (~10 degrees across) rather than a
 * whole hemisphere. Testing at the size we will use is the point.
 * ------------------------------------------------------------------------ */

const R = 20037508.342789244;
const mercX = (lon) => (lon * R) / 180;
const mercY = (lat) => (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (R / 180);

/** bbox string in EPSG:3857, minx,miny,maxx,maxy — the axis order both WMS
 *  1.1.1 and WMS 1.3.0 use for this projected CRS. */
function bbox3857(west, south, east, north) {
  return [mercX(west), mercY(south), mercX(east), mercY(north)].join(',');
}

const BOX = {
  /* Tropical Atlantic — GOES-East territory. */
  atlantic: bbox3857(-65, 15, -55, 25),
  /* East Pacific — GOES-West territory. */
  epac: bbox3857(-125, 12, -115, 22),
  /* West Pacific — Himawari territory, where GOES cannot see at all. */
  wpac: bbox3857(130, 10, 140, 20),
  /* North Indian Ocean — Meteosat IODC territory. */
  indian: bbox3857(60, 8, 70, 18),
};

/** GIBS geostationary layers are time-stepped and want an explicit TIME. Ask
 *  for a frame comfortably behind real time so processing lag cannot make a
 *  valid request look like a broken endpoint. */
function gibsTime(minutesBack) {
  const t = new Date(Date.now() - minutesBack * 60_000);
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 10) * 10);
  return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function wmsGet(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function imageProbes() {
  const png = 'image/png';
  const time = gibsTime(60);

  const gibs = (layer, box) => ({
    id: `gibs-${layer}`,
    why: `NASA GIBS GetMap — ${layer}, real pixels at storm-disc size`,
    kind: 'image',
    url: wmsGet('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
      SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap',
      LAYERS: layer, SRS: 'EPSG:3857', BBOX: box,
      WIDTH: '512', HEIGHT: '512', FORMAT: png, TRANSPARENT: 'true', TIME: time,
    }),
  });

  const iem = (host, layer, box) => ({
    id: `iem-${host}-${layer}`,
    why: `IEM ${host} GetMap — ${layer}, real pixels`,
    kind: 'image',
    url: wmsGet(`https://mesonet.agron.iastate.edu/cgi-bin/wms/${host}.cgi`, {
      service: 'WMS', version: '1.1.1', request: 'GetMap',
      layers: layer, srs: 'EPSG:3857', bbox: box,
      width: '512', height: '512', format: png, transparent: 'true', styles: '',
    }),
  });

  const eum = (layer, box) => ({
    id: `eumetsat-${layer.replace(/[:]/g, '-')}`,
    why: `EUMETSAT GetMap — ${layer}, real pixels`,
    kind: 'image',
    url: wmsGet('https://view.eumetsat.int/geoserver/ows', {
      service: 'WMS', version: '1.3.0', request: 'GetMap',
      layers: layer, crs: 'EPSG:3857', bbox: box,
      width: '512', height: '512', format: png, transparent: 'true', styles: '',
    }),
  });

  return [
    gibs('GOES-East_ABI_Band13_Clean_Infrared', BOX.atlantic),
    gibs('GOES-West_ABI_Band13_Clean_Infrared', BOX.epac),
    gibs('Himawari_AHI_Band13_Clean_Infrared', BOX.wpac),
    iem('goes_east', 'fulldisk_ch13', BOX.atlantic),
    iem('goes_west', 'fulldisk_ch13', BOX.epac),
    eum('msg_iodc:ir108', BOX.indian),
    eum('msg_fes:ir108', BOX.atlantic),
    /* The one layer that might make this a ONE-VENDOR problem: a global IR
     * 10.8 cloud mosaic. If it covers every box at usable resolution, the
     * satellite-by-longitude lookup disappears entirely. */
    eum('mumi:worldcloudmap_ir108', BOX.wpac),
    eum('mumi:worldcloudmap_ir108', BOX.atlantic),
  ];
}

/** Read a PNG's own declaration of what it is. No decoding required. */
function pngHeader(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return { isPng: false };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const COLOR = { 0: 'grayscale', 2: 'rgb', 3: 'palette', 4: 'gray+alpha', 6: 'rgba' };
  const colorType = bytes[25];
  const out = {
    isPng: true,
    width: dv.getUint32(16),
    height: dv.getUint32(20),
    bitDepth: bytes[24],
    colorType,
    colorModel: COLOR[colorType] || `unknown(${colorType})`,
  };
  /* Chunk walk — PLTE means a palette (possibly a color ramp baked in), tRNS
   * means some entries are transparent, which is the vendor doing part of our
   * knockout for us. */
  const chunks = [];
  let p = 8;
  while (p + 8 <= bytes.length && chunks.length < 24) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    chunks.push(type);
    if (type === 'IDAT' || type === 'IEND') break;
    p += 12 + len;
  }
  out.chunks = chunks;
  out.hasPalette = chunks.includes('PLTE');
  out.hasTransparency = chunks.includes('tRNS');
  return out;
}

/* --- helpers ------------------------------------------------------------- */

async function timedFetch(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** The headers that decide whether the browser can touch the pixels. Same-origin
 *  is not required if the vendor sends CORS — and if it does, the relay becomes
 *  a caching choice rather than a hard requirement. */
function corsPicture(r) {
  return {
    allowOrigin: r.headers.get('access-control-allow-origin'),
    contentType: r.headers.get('content-type'),
    cacheControl: r.headers.get('cache-control'),
  };
}

/** Pull layer names out of either WMS (<Name>) or WMTS (<ows:Identifier>). */
function layerNames(xml) {
  const out = [];
  const re = /<(?:ows:)?(?:Name|Identifier)>([^<]{1,160})<\/(?:ows:)?(?:Name|Identifier)>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

/** Formats a service says it can return. PNG matters: SPEC §4 is explicit that
 *  JPEG mosquito noise keys as colored halos, so a PNG-capable service is a
 *  requirement, not a preference. */
function formatsIn(xml) {
  const out = new Set();
  const re = /<Format>([^<]{1,80})<\/Format>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.add(m[1].trim());
  return [...out].filter((f) => /image\//i.test(f));
}

async function runProbe(p) {
  const started = Date.now();
  const row = { id: p.id, why: p.why, url: p.url };
  let r;
  try {
    r = await timedFetch(p.url);
  } catch (e) {
    row.ok = false;
    row.error = String(e && e.message ? e.message : e);
    row.ms = Date.now() - started;
    return row;
  }

  row.status = r.status;
  row.ok = r.ok;
  Object.assign(row, corsPicture(r));

  try {
    if (p.kind === 'image') {
      const buf = await r.arrayBuffer();
      const bytes = new Uint8Array(buf);
      row.bytes = bytes.length;
      const png = pngHeader(bytes);
      Object.assign(row, png);
      /* A WMS that refuses returns an XML ServiceException with a 200 status.
       * Reporting "not a PNG" without the reason wastes a whole round trip. */
      if (!png.isPng) {
        row.notImage = new TextDecoder().decode(bytes.slice(0, 400));
      }
    } else if (p.kind === 'head') {
      const buf = await r.arrayBuffer();
      row.bytes = buf.byteLength;
    } else {
      const text = await r.text();
      row.bytes = text.length;
      const body = text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text;

      if (p.kind === 'caps') {
        const names = layerNames(body);
        row.layerCount = names.length;
        const ir = [...new Set(names.filter((n) => IR_HINT.test(n)))];
        row.irLayers = ir.slice(0, 80);
        row.irLayerCount = ir.length;
        row.imageFormats = formatsIn(body);
        /* EPSG:3857 support is not optional — MapLibre draws in Web Mercator,
         * and a vendor that cannot serve it needs reprojection we will not
         * write. WMS 1.1.1 calls it SRS, 1.3.0 calls it CRS. */
        const srs = new Set();
        const sre = /<(?:SRS|CRS)>([^<]{1,120})<\/(?:SRS|CRS)>/g;
        let sm;
        while ((sm = sre.exec(body)) !== null) for (const s of sm[1].split(/\s+/)) srs.add(s);
        row.has3857 = srs.has('EPSG:3857');
        row.srsSample = [...srs].slice(0, 12);
        /* A time dimension means "there are older frames" — that is the v2.0
         * playback hook, and its presence is worth recording now even though
         * this phase draws one frame. */
        row.hasTimeDimension = /<(?:Dimension|Extent)[^>]*name=["']time["']/i.test(body)
          || /<ows:Identifier>\s*[Tt]ime\s*<\/ows:Identifier>/.test(body);
        if (!ir.length) row.sampleNames = [...new Set(names)].slice(0, 40);
      } else if (p.kind === 'json') {
        try {
          const j = JSON.parse(body);
          row.jsonKeys = Array.isArray(j) ? ['(array)'] : Object.keys(j).slice(0, 30);
          row.sample = JSON.stringify(j).slice(0, 600);
        } catch {
          row.parseError = 'body was not JSON';
          row.sample = body.slice(0, 300);
        }
      }
    }
  } catch (e) {
    row.readError = String(e && e.message ? e.message : e);
  }

  row.ms = Date.now() - started;
  return row;
}

export async function onRequestGet() {
  const started = Date.now();

  /* Run them together — eight sequential 12-second timeouts would blow the
   * Worker's own budget. Each probe already contains its own failure. */
  const all = [...PROBES, ...imageProbes()];
  const results = await Promise.all(all.map(runProbe));

  const body = {
    what: 'Landfall imagery vendor probe — read-only, no parameters',
    generatedAt: new Date().toISOString(),
    totalMs: Date.now() - started,
    question:
      'Which vendors serve clean longwave IR (ABI/AHI band 13, SEVIRI IR 10.8) for the whole tropical belt, are they color-enhanced or grayscale, do they send CORS, and can they return PNG?',
    results,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}
