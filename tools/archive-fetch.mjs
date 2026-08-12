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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
      'Seven-Day Current Location. EVIDENCE, NOT A FEED — the app does not ' +
      'fetch this. It was meant to anchor each percentage, until these bytes ' +
      'showed 3 points against 5 polygons with attributes matching one shape ' +
      'while sitting inside another. Kept archived so the decision can be ' +
      'revisited against real data rather than from memory.',
  },
  {
    name: 'jtwc-abpw.txt',
    url: 'https://www.metoc.navy.mil/jtwc/products/abpwweb.txt',
    note:
      'JTWC Significant Tropical Weather Advisory. Plain text. The only ' +
      'genesis product outside NHC carrying a probability, expressed as ' +
      'LOW/MEDIUM/HIGH within 24 hours. WMO header carries the issue time.',
  },
  /* ==> THE TEXT OUTLOOKS. ADDED 2026-08-11 AND THEY ARE THE POINT OF THAT
   * NIGHT. <== NHC's GIS layer 3 reported zero areas while NHC's own bulletin
   * and public graphic both carried three Atlantic areas, one of them red.
   * Landfall rendered the layer and published a false all-clear.
   *
   * THE REASON THAT COULD NOT BE SETTLED QUICKLY IS THAT NOBODY ARCHIVED THE
   * AUTHORITATIVE COPY. The GIS layer was snapshotted hourly; the product it
   * is derived FROM was not, so the only way to check it was to read a live
   * web page by hand, one issuance at a time, and the answer kept turning out
   * to be an hour stale. Half an hour of a hurricane-season session went on a
   * question these two files answer in one `git show`.
   *
   * AN EMPTY GEOJSON IS UNSTAMPED AND THIS IS THE ANTIDOTE. The layer's empty
   * response carries no `idp_source` and no `idp_filedate`, so on its own it
   * cannot say whether it means "nothing is out there" or "I am broken".
   * These bulletins carry their own WMO header and issuance line in every
   * state, INCLUDING when the answer is genuinely nothing — "Tropical cyclone
   * formation is not expected during the next 7 days" is a stamped, positive
   * statement of an all-clear, which is exactly what the GeoJSON cannot make.
   *
   * Diff the two and the question answers itself. */
  {
    name: 'nhc-two-atlantic.txt',
    url: 'https://www.nhc.noaa.gov/text/MIATWOAT.shtml?text',
    note:
      'ABNT20 KNHC — the Atlantic Tropical Weather Outlook, the AUTHORITATIVE ' +
      'form of what genesis layer 3 is derived from. Issued 0000/0600/1200/' +
      '1800 UTC. Carries its own issuance line in every state, including a ' +
      'genuine all-clear — which the empty GeoJSON cannot. Diff against ' +
      'nhc-genesis-areas.geojson: they must agree, and on 2026-08-11 they ' +
      'did not.',
  },
  {
    name: 'nhc-two-epacific.txt',
    url: 'https://www.nhc.noaa.gov/text/MIATWOEP.shtml?text',
    note:
      'ABPZ20 KNHC — the same product for the East Pacific. Layer 3 carries ' +
      'both basins in one response, so checking only the Atlantic would leave ' +
      'half of any disagreement invisible.',
  },
  /* ==> THE RAW FEEDS, ARCHIVED SO THE UPSTREAM CHOICE CAN BE MADE ON
   * EVIDENCE. <== The relay currently scrapes the `<pre>` block out of the two
   * `.shtml` pages above. These are the same two products as plain text, with
   * no page around them, and switching to them would delete the scrape.
   *
   * They are archived rather than adopted because a NOAA raw path has already
   * been caught lying by omission: `www.nhc.noaa.gov/ftp/pub/forecasts/
   * discussion/MIATWOAT` was serving the 24 JUNE bulletin on 11 AUGUST — plain
   * text, HTTP 200, two months stale, and healthy by every signal except the
   * issue line inside the body. A source we would trust to CONTRADICT another
   * source has to prove it keeps up first. Diff these against the `.shtml`
   * copies over a few days; if they track, the relay switches and this comment
   * goes with it. */
  {
    name: 'nhc-two-atlantic-raw.txt',
    url: 'https://tgftp.nws.noaa.gov/data/raw/ab/abnt20.knhc.two.at.txt',
    note:
      'ABNT20 as plain text, no HTML. Candidate replacement for the scraped ' +
      'page. Measured current 2026-08-11 (111142Z), matching the .shtml copy.',
  },
  {
    name: 'nhc-two-epacific-raw.txt',
    url: 'https://tgftp.nws.noaa.gov/data/raw/ab/abpz20.knhc.two.ep.txt',
    note:
      'ABPZ20 as plain text. THE URL IS INFERRED FROM ITS ATLANTIC SIBLING ' +
      'and has never been fetched — the sandbox cannot reach it and no search ' +
      'returned it directly. If it 404s, that is this entry doing its job: ' +
      'the manifest will say so rather than the guess reaching the relay.',
  },
  {
    name: 'relay-nhc-outlook-atlantic.txt',
    url: 'https://landfall.getgravitate.app/api/nhc/outlook?basin=atlantic',
    note:
      'Our relay in front of the text outlook. Diff against the .shtml copy ' +
      'above: the bulletin must survive the <pre> extraction byte for byte.',
  },
  {
    name: 'relay-nhc-outlook-epacific.txt',
    url: 'https://landfall.getgravitate.app/api/nhc/outlook?basin=epacific',
    note: 'The same, for the East Pacific.',
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
  /* Added the same night, for the same reason. The genesis relay was the one
   * route in the chain nobody could see: upstream was archived and the app's
   * own reading was archived, but the thing in between — including whether it
   * is HOLDING a previous answer — was inferred rather than read. Its
   * `X-Landfall-Held` header is in the manifest now like every other. */
  {
    name: 'relay-nhc-genesis.json',
    url: 'https://landfall.getgravitate.app/api/nhc/genesis?part=areas',
    note:
      'Our relay in front of the genesis layer. The headers are the payload ' +
      'here: X-Landfall-Held says whether the last real answer is being served ' +
      'through an empty upstream, and X-Landfall-Fetched-At says how old it is.',
  },

  /* ==> THE SAME AREAS, FROM A COMPLETELY DIFFERENT NHC PRODUCT. <==
   *
   * MEASURED 2026-08-11: the genesis layer answered 200 with an empty
   * FeatureCollection for hours while NHC's own website drew five areas, and
   * BOTH tropical map services were checked — `NHC_tropical_weather` layer 3
   * and `NHC_tropical_weather_summary` layer 3 — and both were empty. So the
   * emptiness is not a wrong address; the ArcGIS publication of this product
   * simply comes and goes, and it is our only source for the shapes.
   *
   * The KMZ is the outlook as NHC's own map consumers get it, on a different
   * publication path. `gtwo_atl.kmz` was confirmed live and serving
   * `application/vnd.google-earth.kmz`. IT HAS NOT BEEN OPENED — it is a zip,
   * and nothing in the sandbox can reach NOAA to open one. That is precisely
   * why it is archived first and parsed second: three sessions on this feature
   * went wrong by reasoning about bytes nobody had read.
   *
   * ==> THE PACIFIC NAME IS INFERRED FROM ITS ATLANTIC SIBLING AND HAS NEVER
   * BEEN FETCHED. <== If it 404s, the manifest will say so, which is this
   * entry doing its job rather than failing at it. */
  {
    name: 'nhc-gtwo-atlantic.kmz.b64',
    url: 'https://www.nhc.noaa.gov/xgtwo/gtwo_atl.kmz',
    binary: true,
    note:
      'The Graphical Tropical Weather Outlook as a KMZ — a zipped KML holding ' +
      'the same watched areas as GIS layer 3, published on a different path. ' +
      'Base64 here because it is a zip. Archived to decide whether it can be ' +
      'a fallback for the hours when layer 3 answers empty.',
  },
  {
    name: 'nhc-gtwo-epacific.kmz.b64',
    url: 'https://www.nhc.noaa.gov/xgtwo/gtwo_pac.kmz',
    binary: true,
    note:
      'The East Pacific sibling of the entry above. THE FILENAME IS INFERRED ' +
      'and has never been fetched — a 404 here is the answer, not a fault.',
  },
];

/* ---------------------------------------------------------------------------
 * PER-STORM GEOMETRY — DERIVED, NOT LISTED
 *
 * ==> THE ONLY PART OF THIS FILE THAT CANNOT BE A CONSTANT. <== Every source
 * above has a fixed URL. A storm's geometry does not: the address carries the
 * event id AND the episode id, and the episode increments on every update, so
 * the URL for DOLPHIN-26 this hour is not the URL for DOLPHIN-26 last hour.
 * GDACS publishes the right one inside the event list under `url.geometry`, so
 * that is what is used — a link the source gave us keeps working if GDACS moves
 * the endpoint, which is the same rule data/gdacs-geometry.js follows.
 *
 * WHY IT WAS ADDED (2026-08-12). Four storms on screen and not one had a past
 * track. The parser was proven innocent against a shipped sample, no toggle
 * could hide the layer, and nothing had touched the track code — which left
 * two candidates that could only be told apart by reading the actual bytes
 * GDACS is serving right now for these actual storms. The archive held the
 * event list and not one polygon. A question that cannot be answered from
 * inside a session is the exact thing this file exists to remove.
 *
 * ==> IT IS WRITTEN TO latest/ AND DELIBERATELY KEPT OUT OF history/. <== One
 * storm's geometry ran 386 KB in the shipped sample; a handful of live storms
 * is a megabyte or more an hour, and the history keeps 72 hours. That is
 * roughly a hundred megabytes of near-identical polygons to answer questions
 * that are always about NOW — what is the feed serving for this storm today.
 * The rolling window earns its size for the event lists and the bulletins,
 * where "when did this change" is a real question. It does not here. The
 * workflow enforces the split; this file just puts them in a subdirectory.
 *
 * NHC HAS NO EQUIVALENT ENTRY YET, AND THAT IS A GAP RATHER THAN A DECISION.
 * Its geometry comes from an ArcGIS MapServer as one query per layer per storm
 * (data/nhc-mapserver.js), so it is several times the work — and with
 * CurrentStorms.json currently 24 bytes there is not a single Atlantic or
 * Pacific storm to point it at. Untestable code archiving nothing is worse
 * than an honest hole. */

/** How many storms' geometry to pull. A cap rather than a filter: the list is
 *  already only current cyclones, and a season that puts more than this many
 *  up at once has bigger problems than an incomplete archive. Ordered by the
 *  feed's own order, so it is at least stable between runs. */
const GEOMETRY_MAX = 8;

/** GDACS's own live flag, published as the STRING "true". Same test as
 *  data/gdacs.js `isCurrent`, restated rather than imported: this script runs
 *  on a bare runner with no bundler and must not drag the app's module graph
 *  onto it. If the two ever disagree the archive holds MORE than the app
 *  parses, which is the safe direction for a diagnostic. */
const isCurrentRow = (v) => v === true || String(v).toLowerCase() === 'true';

/** Safe in a filename and still readable at a glance. The event and episode
 *  ids are what make it unambiguous; the name is there so a session looking
 *  for PEILOU can find it without opening four files. */
const slug = (s) => String(s || 'unnamed').replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40);

function geometrySources(eventListJson) {
  const feats = Array.isArray(eventListJson?.features) ? eventListJson.features : [];
  const out = [];
  for (const f of feats) {
    const p = f?.properties || {};
    if ((p.eventtype || '') !== 'TC') continue;
    if (!isCurrentRow(p.iscurrent)) continue;
    const url = p.url?.geometry;
    /* ==> THE PUBLISHED URL OR NOTHING. <== Building one by hand would mean
     * this script inventing an address, and an invented address that 404s
     * looks identical in the manifest to a storm GDACS has no polygons for.
     * A row without the link is skipped and said so. */
    if (typeof url !== 'string' || !url.startsWith('https://www.gdacs.org/')) continue;
    out.push({
      name: `geometry/gdacs-${slug(p.eventname)}-${p.eventid}-e${p.episodeid}.json`,
      url,
      note:
        `Per-storm GDACS polygons for ${p.eventname} (event ${p.eventid}, ` +
        `episode ${p.episodeid}). Cone, wind bands, the pre-merged swath, the ` +
        `centre dots, and the Line_* track segments whose \`forecast\` flag ` +
        `splits past from future. Last analysed ${p.todate || 'unknown'}.`,
    });
    if (out.length >= GEOMETRY_MAX) break;
  }
  return out;
}

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
    const isBinary = src.binary === true;
    /* ==> A BINARY SOURCE CANNOT GO THROUGH `text()`. <== It decodes as UTF-8,
     * and every byte that is not valid UTF-8 comes out as a replacement
     * character — silently, with a plausible-looking length. A zip archive run
     * through that is unrecoverable. Binary sources are read as bytes and
     * written base64, and the byte count reported is the REAL one so the
     * manifest still says whether the thing arrived. */
    const buf = isBinary ? Buffer.from(await res.arrayBuffer()) : null;
    const body = isBinary ? buf.toString('base64') : await res.text();
    const byteLength = isBinary ? buf.length : body.length;
    const headers = Object.fromEntries(res.headers.entries());

    /* An HTTP error still has a body worth keeping — an NHC maintenance page
       tells you more than "500". But it is NOT written to latest/, because
       latest/ must only ever hold something the app could actually parse. */
    const okish = res.ok && byteLength > 0;
    return {
      name: src.name,
      url: src.url,
      note: src.note,
      status: okish ? 'ok' : 'unavailable',
      http: res.status,
      httpText: res.statusText,
      bytes: byteLength,
      ms: Date.now() - started,
      headers,
      body,
      reason: okish ? null : `HTTP ${res.status} ${res.statusText}, ${byteLength} bytes`,
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
mkdirSync(join(OUT, 'geometry'), { recursive: true });

const results = [];

/** Fetch one source, write it, log it. Extracted when the geometry phase
 *  arrived, because a second copy of this would be a second place for the
 *  "a failure writes no data file" rule to drift out of. */
async function run(src) {
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
    `${r.status === 'ok' ? 'ok  ' : 'FAIL'} ${r.name.padEnd(44)} ` +
      `${String(r.http ?? '-').padStart(3)}  ${String(r.bytes).padStart(8)} B  ${r.ms} ms` +
      (r.reason ? `  ${r.reason}` : '')
  );
  return r;
}

for (const src of SOURCES) await run(src);

/* ==> PHASE TWO: THE STORMS THE FIRST PHASE JUST FOUND. <==
 *
 * Reads the file that was WRITTEN rather than holding the body in memory, so
 * the geometry phase runs against exactly the bytes a session will read. If
 * the event list failed, there is nothing on disk, nothing is derived, and the
 * manifest already says the list is unavailable — no second complaint needed
 * and no invented storm list to fall back on. */
let geometryCount = 0;
try {
  const list = JSON.parse(readFileSync(join(OUT, 'gdacs-events.json'), 'utf8'));
  const derived = geometrySources(list);
  console.log(`\nderived ${derived.length} per-storm geometry URL(s) from the GDACS list`);
  for (const src of derived) {
    const r = await run(src);
    if (r.status === 'ok') geometryCount++;
  }
} catch (err) {
  console.log(
    `\nno per-storm geometry this run — ${String(err && err.message ? err.message : err)}`
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
      geometryNote:
        'Sources under geometry/ are per-storm GDACS polygons, derived from ' +
        "this run's event list rather than from a fixed URL. They live in " +
        'latest/ ONLY and are not carried into history/ — a megabyte an hour ' +
        'across a 72-hour window buys nothing, because the question they ' +
        'answer is always about now. Do not go looking for them in a snapshot.',
      geometryStorms: geometryCount,
      ok: okCount,
      unavailable: results.length - okCount,
      sources: results,
    },
    null,
    2
  ) + '\n'
);

console.log(`\n${okCount}/${results.length} sources ok — manifest.json written to ${OUT}`);
