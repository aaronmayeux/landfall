#!/usr/bin/env node
/**
 * archive-fetch.mjs — pull the live payloads and write them somewhere a session
 * can read the exact bytes.
 *
 * WHY THIS EXISTS
 * The cloud sandbox reaches GitHub and npm and nothing else. `curl` there
 * cannot touch nhc.noaa.gov, gdacs.org, or even our own app. WebFetch can, but
 * it shows no response headers and runs a small model over anything large, so
 * a big payload comes back approximated rather than verbatim. That is fine for
 * "is it up" and useless for "what exactly did the wind field say".
 *
 * A GitHub Actions runner has open internet. This runs there, hourly, and
 * commits the bytes to the `archive` branch. A session — or Aaron on a phone —
 * then reads them with plain git:
 *
 *     git fetch origin archive
 *     git show origin/archive:latest/nhc-currentstorms.json
 *
 * IT ALSO CAPTURES RESPONSE HEADERS, WHICH IS HALF THE POINT
 * `X-Landfall-Cache` has never been read by any session, because nothing
 * available in a session shows headers. Every header of every response lands in
 * manifest.json here.
 *
 * FAILURE IS RECORDED, NEVER SWALLOWED (§5)
 * A source that errors is written as status "unavailable" with the reason. It
 * is never written as an empty file, because an empty file is indistinguishable
 * from "no storms" and that confusion is the exact safety-adjacent bug the spec
 * forbids. Nothing is written for a failed source, so the previous good copy
 * stays put and manifest.json says why it is old.
 *
 * Zero dependencies. Run: node tools/archive-fetch.mjs <output-dir>
 * Exits 0 even when sources fail — a bad upstream is news, not a broken build.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node tools/archive-fetch.mjs <output-dir>');
  process.exit(2);
}

/** Be identifiable in their logs, same string the relay uses. */
const UA = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const TIMEOUT_MS = 30_000;

/* The upstreams, and our own relay in front of them. Keeping both is the point:
   a session can diff what the Navy said against what our edge served, which is
   the difference between "the feed is broken" and "we are broken", and that has
   cost whole sessions of guessing. */
const SOURCES = [
  {
    name: 'nhc-currentstorms.json',
    url: 'https://www.nhc.noaa.gov/CurrentStorms.json',
    note: 'NHC upstream. The list every Atlantic/Pacific storm comes from.',
  },
  {
    name: 'gdacs-events.json',
    url:
      'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH' +
      '?eventlist=TC&alertlevel=Green;Orange;Red',
    note: 'GDACS upstream. 100 rows verbatim, filtered downstream not here.',
  },
  {
    name: 'jtwc.rss',
    url: 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss',
    note: 'JTWC index. Warning products are linked from inside it.',
  },
  /* GENESIS — §45. The two sources that answer "where might the next one
     start", and the reason this pass added them: nothing in a session can
     reach either host, so no parser can be written honestly until these bytes
     land here. Layer 3 carries BOTH horizons on one polygon; layer 2 is NHC's
     own label anchor, archived because the map layer hangs the seven-day
     percentage on it rather than on a centroid we computed ourselves. */
  {
    name: 'nhc-genesis-areas.geojson',
    url:
      'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/' +
      'NHC_tropical_weather/MapServer/3/query' +
      '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson',
    note:
      'NHC Seven-Day Potential Development Region. One polygon per watched ' +
      'area, carrying prob2day/risk2day/prob7day/risk7day. Probabilities are ' +
      'STRINGS with a percent sign. idp_filedate is the publication stamp.',
  },
  {
    name: 'nhc-genesis-anchors.geojson',
    url:
      'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/' +
      'NHC_tropical_weather/MapServer/2/query' +
      '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson',
    note:
      "Seven-Day Current Location — NHC's own label anchor for the polygons " +
      'above. The map layer puts the percentage here, so a session needs to ' +
      'see whether the point count matches the polygon count.',
  },
  {
    name: 'jtwc-abpw.txt',
    url: 'https://www.metoc.navy.mil/jtwc/products/abpwweb.txt',
    note:
      'JTWC Significant Tropical Weather Advisory. Plain text. The only ' +
      'genesis product outside NHC carrying a probability, expressed as ' +
      'LOW/MEDIUM/HIGH within 24 hours. WMO header carries the issue time.',
  },
  {
    name: 'relay-nhc-storms.json',
    url: 'https://landfall.getgravitate.app/api/nhc/storms',
    note: 'Our relay in front of NHC. Diff against the upstream copy above.',
  },
  {
    name: 'relay-gdacs-events.json',
    url: 'https://landfall.getgravitate.app/api/gdacs/events',
    note: 'Our relay in front of GDACS.',
  },
];

async function grab(src) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(src.url, {
      headers: { 'user-agent': UA, accept: '*/*' },
      signal: ctl.signal,
      redirect: 'follow',
    });
    const body = await res.text();
    const headers = Object.fromEntries(res.headers.entries());

    /* An HTTP error still has a body worth keeping — an NHC maintenance page
       tells you more than "500". But it is NOT written to latest/, because
       latest/ must only ever hold something the app could actually parse. */
    const okish = res.ok && body.length > 0;
    return {
      name: src.name,
      url: src.url,
      note: src.note,
      status: okish ? 'ok' : 'unavailable',
      http: res.status,
      httpText: res.statusText,
      bytes: body.length,
      ms: Date.now() - started,
      headers,
      body,
      reason: okish ? null : `HTTP ${res.status} ${res.statusText}, ${body.length} bytes`,
    };
  } catch (err) {
    return {
      name: src.name,
      url: src.url,
      note: src.note,
      status: 'unavailable',
      http: null,
      bytes: 0,
      ms: Date.now() - started,
      headers: {},
      body: null,
      reason: String(err && err.message ? err.message : err),
    };
  } finally {
    clearTimeout(timer);
  }
}

const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
mkdirSync(OUT, { recursive: true });

const results = [];
for (const src of SOURCES) {
  const r = await grab(src);
  if (r.status === 'ok') {
    writeFileSync(join(OUT, r.name), r.body);
  } else if (r.body != null) {
    /* Keep the error body under a name that cannot be mistaken for real data. */
    writeFileSync(join(OUT, r.name + '.error.txt'), r.body);
  }
  delete r.body;
  results.push(r);
  console.log(
    `${r.status === 'ok' ? 'ok  ' : 'FAIL'} ${r.name.padEnd(30)} ` +
      `${String(r.http ?? '-').padStart(3)}  ${String(r.bytes).padStart(8)} B  ${r.ms} ms` +
      (r.reason ? `  ${r.reason}` : '')
  );
}

const okCount = results.filter((r) => r.status === 'ok').length;

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      fetchedAt: stamp,
      runner: 'github-actions',
      note:
        'Written by tools/archive-fetch.mjs. Every response header of every ' +
        'source is here, including X-Landfall-Cache, which nothing inside a ' +
        'session can show you.',
      ok: okCount,
      unavailable: results.length - okCount,
      sources: results,
    },
    null,
    2
  ) + '\n'
);

console.log(`\n${okCount}/${results.length} sources ok — manifest.json written to ${OUT}`);
