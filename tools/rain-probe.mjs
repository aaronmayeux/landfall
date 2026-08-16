/**
 * rain-probe.mjs — ONE-SHOT survey of every candidate source for rainfall.
 *
 * ==> WHY THIS EXISTS AND WHY IT IS NOT PART OF THE HOURLY ARCHIVE. <==
 * A session reaches GitHub and npm and nothing else, so no rainfall source can
 * be measured from inside one. `archive-fetch.mjs` is the standing bridge, but
 * it snapshots feeds the app ALREADY uses. This is a survey of feeds we are
 * still deciding about, so it lives apart and is thrown away once the decision
 * is made. Nothing in the app imports it.
 *
 * ==> THE QUESTION IT IS BUILT TO ANSWER. <==
 * "Can we tell someone how much rain is coming to THEIR house, from an
 * official source, everywhere NHC forecasts?" Everything here is aimed at
 * that. The map layer is out of scope by decision; the WPC polygon query is
 * captured anyway, as one small sample, only so the choice stays reversible.
 *
 * ==> WHAT IT WRITES. <==
 *   manifest.json    every source: status, HTTP, bytes, ms, and every response
 *                    header. Headers are the half nothing else can show us.
 *   raw/...          the exact bytes, unmodified, one file per source
 *   summary.md       the derived answer per probe point — does a rainfall
 *                    series exist here, in what units, over what horizon
 *
 * ==> THE PROBE POINTS ARE CHOSEN, NOT SAMPLED. <== Each one is a question:
 * Hilo and Kahului are under Lala right now and are named in her advisory's
 * RAINFALL paragraph, so they are the live test. San Juan and Tamuning ask
 * whether non-CONUS coverage is real or a documentation claim. Galveston and
 * Key West are the ordinary CONUS case. Nassau is OUTSIDE every NWS forecast
 * area on purpose — §5 needs to know what "we do not cover this" looks like on
 * the wire, because a feature that cannot tell that from a fetch failure will
 * eventually show an all-clear it has not earned.
 *
 * Zero dependencies. Plain node, plain fetch. Run:
 *     node tools/rain-probe.mjs /tmp/rain
 */

/* NWS refuses anonymous clients and asks for a contact in the agent string.
 * Without this api.weather.gov answers 403 and the whole probe reads as a
 * dead source rather than as our own missing header. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';

/* A source that has not answered in this long is reported as a timeout rather
 * than hanging the whole run. Generous, because some of these are slow. */
const TIMEOUT_MS = 30_000;

/* ---------------------------------------------------------------------------
 * PROBE POINTS
 * ------------------------------------------------------------------------ */

const POINTS = [
  { id: 'hilo-hi', label: 'Hilo, Big Island HI', lat: 19.7203, lon: -155.0868,
    why: 'Under Lala now. Her advisory says 10-20 in with a 25 in max here.' },
  { id: 'kahului-hi', label: 'Kahului, Maui HI', lat: 20.8893, lon: -156.4729,
    why: 'Second island named in the same paragraph, at a lower total.' },
  { id: 'honolulu-hi', label: 'Honolulu, Oahu HI', lat: 21.3070, lon: -157.8583,
    why: 'The "remainder of the island chain" band, 4-6 in.' },
  { id: 'san-juan-pr', label: 'San Juan PR', lat: 18.4655, lon: -66.1057,
    why: 'The other non-CONUS case that matters for Atlantic storms.' },
  { id: 'galveston-tx', label: 'Galveston TX', lat: 29.3013, lon: -94.7977,
    why: 'Ordinary CONUS Gulf coast. Should be the easy one.' },
  { id: 'key-west-fl', label: 'Key West FL', lat: 24.5551, lon: -81.7800,
    why: 'CONUS, but far enough south to sit near the edge of the grid.' },
  { id: 'tamuning-gu', label: 'Tamuning, Guam', lat: 13.4791, lon: 144.7737,
    why: 'West Pacific. GDACS/JTWC territory — does NWS reach here at all?' },
  { id: 'nassau-bs', label: 'Nassau, Bahamas', lat: 25.0480, lon: -77.3554,
    why: 'DELIBERATELY OUTSIDE NWS. What does no-coverage look like on the wire?' },
];

/* ---------------------------------------------------------------------------
 * FETCH PLUMBING
 * ------------------------------------------------------------------------ */

const manifest = { probedAt: new Date().toISOString(), runner: 'github-actions', sources: [] };

async function grab(name, url, note, { binary = false } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const rec = { name, url, note, status: 'unavailable', http: null, httpText: '',
                bytes: 0, ms: 0, headers: {}, reason: null };
  let body = null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, signal: ctrl.signal });
    rec.http = r.status;
    rec.httpText = r.statusText || '';
    for (const [k, v] of r.headers) rec.headers[k] = v;
    const buf = Buffer.from(await r.arrayBuffer());
    rec.bytes = buf.length;
    body = binary ? buf : buf.toString('utf8');
    /* A 404 is an ANSWER, not a failure — it is how "we do not forecast here"
     * arrives, and collapsing it into `unavailable` would hide exactly the
     * distinction §5 exists to protect. */
    rec.status = r.ok ? 'ok' : (r.status === 404 ? 'not_covered' : 'http_error');
    if (!r.ok) rec.reason = `HTTP ${r.status} ${r.statusText}`;
  } catch (e) {
    rec.reason = String(e?.message || e);
  } finally {
    clearTimeout(timer);
    rec.ms = Date.now() - started;
  }
  manifest.sources.push(rec);
  return { rec, body };
}

/* ---------------------------------------------------------------------------
 * MAIN
 * ------------------------------------------------------------------------ */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || '/tmp/rain';
const RAW = join(OUT, 'raw');

/** Per-point derived findings, which is what `summary.md` is built from. */
const findings = [];

async function save(rel, data) {
  const p = join(RAW, rel);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, data);
}

/** Sum an NWS gridpoint series over its whole published window.
 *
 *  `validTime` is an ISO 8601 INTERVAL — "2026-08-16T00:00:00+00:00/PT6H" —
 *  not a timestamp. The duration half is what says how long the value covers,
 *  and a reader that splits on 'T' instead of '/' silently gets nonsense. */
function summariseSeries(series) {
  if (!series || !Array.isArray(series.values) || series.values.length === 0) return null;
  const vals = series.values;
  let total = 0;
  for (const v of vals) if (Number.isFinite(v.value)) total += v.value;
  const firstStart = String(vals[0].validTime).split('/')[0];
  const lastStart = String(vals[vals.length - 1].validTime).split('/')[0];
  return {
    uom: series.uom || null,          // e.g. "wmoUnit:mm" — DO NOT assume inches
    count: vals.length,
    total,
    firstValidFrom: firstStart,
    lastValidFrom: lastStart,
    /* Kept verbatim so the interval format can be read rather than guessed. */
    sampleValidTime: vals[0].validTime,
  };
}

async function probePoint(p) {
  const f = { ...p, points: null, grid: null, qpf: null, alerts: null, notes: [] };

  /* Step 1 — /points resolves a lat/lon to a forecast office and grid cell.
   * It is also the ONLY thing that answers "is this place forecast at all",
   * which is why the Bahamas point is here. */
  const { rec: pr, body: pBody } = await grab(
    `weather-gov/points/${p.id}`,
    `https://api.weather.gov/points/${p.lat},${p.lon}`,
    `Resolve ${p.label} to an NWS grid. ${p.why}`,
  );
  await save(`weather-gov/points-${p.id}.json`, pBody ?? '');
  f.points = { status: pr.status, http: pr.http };

  let gridUrl = null;
  if (pr.status === 'ok') {
    try {
      const j = JSON.parse(pBody);
      gridUrl = j?.properties?.forecastGridData || null;
      f.office = j?.properties?.gridId || null;
      f.cell = (j?.properties?.gridX != null) ? `${j.properties.gridX},${j.properties.gridY}` : null;
    } catch (e) { f.notes.push(`points JSON unparseable: ${e.message}`); }
  } else {
    f.notes.push(`no grid: ${pr.reason || pr.status}`);
  }

  /* Step 2 — the raw numeric grid. This is the payload the whole feature would
   * live on, so it is saved WHOLE rather than filtered. It is also big, which
   * is itself a finding worth measuring rather than estimating. */
  if (gridUrl) {
    const { rec: gr, body: gBody } = await grab(
      `weather-gov/grid/${p.id}`, gridUrl,
      `Raw numeric forecast grid for ${p.label}. quantitativePrecipitation lives here.`,
    );
    await save(`weather-gov/grid-${p.id}.json`, gBody ?? '');
    f.grid = { status: gr.status, http: gr.http, bytes: gr.bytes, ms: gr.ms };
    if (gr.status === 'ok') {
      try {
        const j = JSON.parse(gBody);
        f.qpf = summariseSeries(j?.properties?.quantitativePrecipitation);
        f.pop = summariseSeries(j?.properties?.probabilityOfPrecipitation) ? 'present' : 'absent';
        f.updateTime = j?.properties?.updateTime || null;
        if (!f.qpf) f.notes.push('quantitativePrecipitation MISSING or empty for this office');
      } catch (e) { f.notes.push(`grid JSON unparseable: ${e.message}`); }
    }
  }

  /* Step 3 — active alerts at the point. Flash Flood Watch/Warning is the
   * CONSEQUENCE of the rainfall and may be more actionable than any total.
   * Captured because it is one host and one auth story away from step 2. */
  const { rec: ar, body: aBody } = await grab(
    `weather-gov/alerts/${p.id}`,
    `https://api.weather.gov/alerts/active?point=${p.lat},${p.lon}`,
    `Active alerts at ${p.label} — flood watches/warnings if any are up.`,
  );
  await save(`weather-gov/alerts-${p.id}.json`, aBody ?? '');
  f.alerts = { status: ar.status, http: ar.http };
  if (ar.status === 'ok') {
    try {
      const j = JSON.parse(aBody);
      f.alertEvents = (j.features || []).map((x) => x?.properties?.event).filter(Boolean);
    } catch { f.notes.push('alerts JSON unparseable'); }
  }

  findings.push(f);
}

async function main() {
  await mkdir(RAW, { recursive: true });

  for (const p of POINTS) await probePoint(p);

  /* --- The advisory paragraph, which is the other half of the feature ----- */
  const { body: lala } = await grab(
    'nhc/advisory-lala',
    'https://www.nhc.noaa.gov/text/MIATCPCP2.shtml',
    'Lala public advisory. Wrong slot on purpose is possible — CP storms use HFO, see below.',
  );
  await save('nhc/advisory-MIATCPCP2.html', lala ?? '');

  const { body: lalaHfo } = await grab(
    'nhc/advisory-lala-hfo',
    'https://www.nhc.noaa.gov/text/HFOTCPCP2.shtml',
    'Lala public advisory, HFO slot. This is the one that should carry RAINFALL.',
  );
  await save('nhc/advisory-HFOTCPCP2.html', lalaHfo ?? '');

  /* --- WPC QPF, one small sample. OUT OF SCOPE by decision; captured so the
   * decision can be revisited against bytes rather than against memory. ---- */
  await grab(
    'wpc/qpf-day1-5',
    'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer/10/query'
      + '?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=25&f=geojson',
    'WPC 5-day QPF, attributes only. Confirms field names, units and issue times.',
  ).then(({ body }) => save('wpc/qpf-day1-5-attrs.geojson', body ?? ''));

  /* --- The companion storm summary: OBSERVED rainfall by named place. ----- */
  const { body: ss } = await grab(
    'wpc/storm-summary',
    'https://www.wpc.ncep.noaa.gov/discussions/nfdscc2.html',
    'ACUS42 KWBC storm summary — measured rainfall and wind by location.',
  );
  await save('wpc/storm-summary.html', ss ?? '');

  /* --- Write it all out -------------------------------------------------- */
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
  await writeFile(join(OUT, 'summary.md'), renderSummary());

  const bad = manifest.sources.filter((s) => s.status === 'unavailable').length;
  console.log(`rain-probe: ${manifest.sources.length} sources, ${bad} unreachable -> ${OUT}`);
}

function renderSummary() {
  const L = [];
  L.push('# rain-probe — what the sources actually said');
  L.push('');
  L.push(`Probed ${manifest.probedAt}. Generated by \`tools/rain-probe.mjs\`.`);
  L.push('');
  L.push('## Local projected rainfall, per point');
  L.push('');
  L.push('| Point | Office | /points | Grid | QPF series | Units | Values | Total | Through |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const f of findings) {
    const q = f.qpf;
    L.push(`| ${f.label} | ${f.office || '—'} | ${f.points?.http ?? '—'} `
      + `| ${f.grid ? `${f.grid.http} (${f.grid.bytes} B)` : '—'} `
      + `| ${q ? 'yes' : 'NO'} | ${q?.uom || '—'} | ${q?.count ?? '—'} `
      + `| ${q ? q.total.toFixed(2) : '—'} | ${q?.lastValidFrom || '—'} |`);
  }
  L.push('');
  L.push('## Alerts in force at each point');
  L.push('');
  for (const f of findings) {
    const ev = f.alertEvents;
    L.push(`- **${f.label}** — ${ev == null ? `alerts unavailable (${f.alerts?.http ?? 'no response'})`
      : ev.length === 0 ? 'none in force' : ev.join(', ')}`);
  }
  L.push('');
  L.push('## Notes raised during the probe');
  L.push('');
  const noted = findings.filter((f) => f.notes.length);
  if (!noted.length) L.push('_None._');
  for (const f of noted) for (const n of f.notes) L.push(`- **${f.label}** — ${n}`);
  L.push('');
  L.push('## Every source, with headers');
  L.push('');
  L.push('| Source | Status | HTTP | Bytes | ms |');
  L.push('|---|---|---|---|---|');
  for (const s of manifest.sources) {
    L.push(`| \`${s.name}\` | ${s.status} | ${s.http ?? '—'} | ${s.bytes} | ${s.ms} |`);
  }
  L.push('');
  L.push('Full headers are in `manifest.json`. Raw bytes are under `raw/`.');
  L.push('');
  return L.join('\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
