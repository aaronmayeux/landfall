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
    if (p.kind === 'head') {
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
  const results = await Promise.all(PROBES.map(runProbe));

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
