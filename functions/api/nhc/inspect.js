/**
 * /api/nhc/inspect — READ-ONLY probe into the NHC tropical MapServer.
 *
 * WHY THIS EXISTS. The cloud sandbox Andy works in cannot reach NOAA: its
 * egress proxy allowlists github.com and package registries, and everything
 * else returns 403 `host_not_allowed`. That has meant every statement about
 * the SHAPE of NHC's geometry — how many features a layer returns, what
 * fields they carry, whether a swath arrives merged or per-forecast-hour —
 * was inference from layer names and documentation. Three consecutive wrong
 * diagnoses of the wind swath's jagged edges came out of exactly that gap
 * (SPEC §15). This endpoint closes it: the deployed site CAN reach NOAA, so
 * it fetches on request and reports what actually came back.
 *
 * SAFE TO LEAVE DEPLOYED, unlike the probe scaffolding it replaces (§15,
 * which committed responses to the repo and needed a GitHub token and a
 * reminder to delete it). This one:
 *   - only ever GETs from one hardcoded NOAA host,
 *   - writes nothing, anywhere,
 *   - needs no secret,
 *   - returns metadata and truncated samples, not bulk geometry.
 * The worst it can do is make NOAA requests, which the site already makes.
 *
 * USAGE:
 *   /api/nhc/inspect                     → the service's whole layer list
 *   /api/nhc/inspect?layer=6             → summary of layer 6's features
 *   /api/nhc/inspect?layer=6&geom=1      → include coordinate counts per ring
 *   /api/nhc/inspect?layer=6&where=...   → custom filter (default 1=1)
 *   /api/nhc/inspect?text=EP2            → RAW SHAPE of a text product page
 *   /api/nhc/inspect?text=EP2&kind=TCD   → discussion instead of the advisory
 *   /api/nhc/inspect?track=EP2           → PAST vs FORECAST track, side by side
 *   /api/nhc/inspect?service=blocks&...  → ask the RETIRED block service
 *   /api/nhc/inspect?warm=1              → THE WARM STORE: is KV bound, every
 *                                          key, and how old each stamp is
 *
 * `service` defaults to `summary`, which is what the app reads. `blocks` is
 * the per-storm block service — useful for exactly one question: do the two
 * services disagree about where a storm's geometry is? They did on
 * 2026-07-26, and that is why the app changed (§4).
 *
 * Deliberately NOT a general proxy: `layer` must be a plain integer, `text`
 * must be a bin number, `kind` and `service` come from fixed sets, and every
 * host is hardcoded — this cannot be pointed at arbitrary URLs.
 */

import { guardInspect } from '../_inspect-guard.js';
import { kvBinding, KV_PREFIX } from '../_kv-cache.js';

/**
 * ?warm=1 — WHAT IS ACTUALLY IN THE WARM STORE, AND HOW OLD IT IS.
 *
 * ==> THIS EXISTS BECAUSE THE ONE NUMBER THAT DRIVES THE "FEED DELAYED"
 *     BANNER WAS INVISIBLE FROM EVERYWHERE. <==
 * `fetchedAt` had exactly one reader — `ui/status.js` — and was never DISPLAYED
 * anywhere: not in the strip, not in the detail panel, not in telemetry, and
 * not in any inspect route. So the app could say a feed was delayed and could
 * not say by how much, or which of five cache layers had answered. Two full
 * sessions went into inferring a value the system already held, and neither
 * ever confirmed whether the Pages project could even READ the store.
 *
 * ==> AND THE OTHER HALF: A WARM CYCLE CANNOT PROVE THE READ SIDE WORKS. <==
 * The cron's summary reports what it WROTE. Every route short-circuits the KV
 * read on a warm request (`isWarmRequest`), so a perfectly healthy cycle says
 * nothing about whether `LANDFALL_CACHE` is bound on the Pages project under
 * that exact name. A binding typo does not throw — `kvRead` returns null
 * forever and every route quietly falls through to upstream. The whole pass
 * deploys successfully and does nothing. `binding: false` below is that
 * failure, stated in one word.
 *
 * `list()` returns every key's METADATA WITHOUT ITS VALUE, so this whole view
 * costs one KV operation and reads back not one byte of a 400 kB geometry
 * blob. Same property `worker/src/kv.js` relies on for the hash map.
 *
 * The hash is deliberately NOT reported. It answers "did the bytes change",
 * which is the question that already caused one regression by being mistaken
 * for "did we reach upstream". Nothing here should invite that confusion again.
 */
async function warmStoreReport(env) {
  const kv = kvBinding(env);
  if (!kv) {
    return {
      binding: false,
      note:
        'LANDFALL_CACHE is not bound on this Pages project, or is bound as a ' +
        'plain variable rather than a KV namespace. Every relay route is ' +
        'silently falling through to upstream on every request.',
    };
  }

  const now = Date.now();
  const entries = [];
  let cursor;
  /* Paginated for the same reason the writer is: list() caps at 1000 keys and
   * an unpaginated read would silently report only the first page. */
  for (;;) {
    const page = await kv.list({ prefix: `${KV_PREFIX}:`, cursor });
    for (const k of page.keys) {
      const stamp = k.metadata && k.metadata.fetchedAt ? String(k.metadata.fetchedAt) : null;
      const ms = stamp ? Date.parse(stamp) : NaN;
      entries.push({
        key: k.name,
        fetchedAt: stamp,
        /* ONE DECIMAL, IN MINUTES, because that is the unit every window in
         * this system is expressed in and the unit the banner threshold uses.
         * Milliseconds would need arithmetic done by whoever is reading this
         * on a phone at the time it matters. */
        ageMin: Number.isFinite(ms) ? Math.round(((now - ms) / 60000) * 10) / 10 : null,
      });
    }
    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    binding: true,
    now: new Date(now).toISOString(),
    keys: entries.length,
    /* The two numbers any reading of the above is judged against, stated here
     * rather than remembered: past `delayedAfterMin` the status strip says the
     * feed is delayed, and a list entry older than `listFreshMin` is declined
     * by its route and sent upstream. Mirrors RELAY_AGE.delayedAfter in
     * config/constants.js and FRESH_SECONDS in the two list routes. */
    thresholds: { listFreshMin: 30, delayedAfterMin: 90 },
    entries,
  };
}

/* BOTH TROPICAL SERVICES, BY NAME, AND NOTHING ELSE. `summary` is what the app
 * actually reads (one flat set of products keyed by `binnumber`); `blocks` is
 * the per-storm block service the app retired on 2026-07-26 — kept reachable
 * here precisely BECAUSE it is retired. The bug that forced the switch was
 * "these two services disagree about where a storm is", and the only way to
 * see that again is to be able to ask both. `?service=blocks` selects it;
 * anything unrecognised falls back to `summary` rather than erroring, since
 * this is a probe and the useful default is the one the app uses.
 *
 * Still deliberately NOT a general proxy: two hardcoded hosts, chosen by an
 * allowlisted keyword, never by caller-supplied URL. */
const SERVICES = {
  summary:
    'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer',
  blocks:
    'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer',
};
const serviceFor = (url) =>
  SERVICES[String(url.searchParams.get('service') || '').toLowerCase()] || SERVICES.summary;

/* --- the text-product probe -------------------------------------------------
 * WHY IT IS HERE. Phase 6 step 6 renders the advisory text, and the product
 * arrives as `.shtml` — an HTML page wrapping the teletype product, not a raw
 * file. Which element wraps it decides the whole extractor, and the sandbox
 * cannot reach NOAA to look. Writing a parser against a guess at that wrapper
 * is the exact mistake §15 records three times over. So: look first.
 *
 * TWO THINGS WERE ALREADY CONFIRMED FROM OUTSIDE and are not re-litigated
 * here — `publicAdvisory.url` in CurrentStorms.json points at the bare slot
 * page `/text/MIATCPEP1.shtml`, which served a DEAD STORM from six weeks
 * prior (Amanda, June 7) while the feed said Fausto; and the `/text/refresh/`
 * path serves the current product with ANY value in its timestamp segment —
 * `000000` and `999999` both returned the live advisory. The timestamp is a
 * cache-buster, not a selector. This probe reports the raw BYTES so the
 * extractor is written against structure rather than recollection.
 * -------------------------------------------------------------------------- */

const TEXT_HOST = 'https://www.nhc.noaa.gov';

/** The three per-storm text products, by their WMO product prefix. TCM (the
 *  forecast advisory) is coded and machine-bound; it is listed for
 *  completeness, not because the app renders it. */
const TEXT_KIND = Object.freeze({
  TCP: 'MIATCP', // public advisory — plain language
  TCD: 'MIATCD', // forecaster discussion
  TCM: 'MIATCM', // forecast advisory — coded
});

/** Bin numbers look like `AT2`, `EP1`, `CP1` — two letters, one digit. */
const BIN_RE = /^[A-Z]{2}\d$/;

/** Every tag name in the document with a count. The answer to "what wraps the
 *  product" is whichever container appears once and holds thousands of
 *  characters — which the block report below measures directly. */
function tagInventory(html) {
  const counts = {};
  for (const m of html.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9]*)\b/g)) {
    const t = m[1].toLowerCase();
    counts[t] = (counts[t] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

/** Every <pre> in the document: its full opening tag (so the class name is
 *  visible), how much it holds, and enough of the head and tail to confirm it
 *  is the product and to see how it terminates. */
function preBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<pre\b([^>]*)>([\s\S]*?)<\/pre\s*>/gi)) {
    const body = m[2];
    out.push({
      openTag: `<pre${m[1]}>`,
      length: body.length,
      head: body.slice(0, 300),
      tail: body.slice(-200),
    });
  }
  return out;
}

/** NOAA 403s requests with no User-Agent. Same identity the storms relay uses. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** How many features to describe in full. A swath layer returning three
 *  polygons is the interesting case; a hundred would be noise. */
const SAMPLE_LIMIT = 12;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });

async function getUpstream(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
  const body = await r.json();
  if (body?.error) throw new Error(body.error.message || 'ArcGIS error');
  return body;
}

/** Count coordinates in a GeoJSON geometry without dumping them all. */
function ringSummary(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', rings: geometry.coordinates.map((r) => r.length) };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      parts: geometry.coordinates.length,
      rings: geometry.coordinates.map((p) => p.map((r) => r.length)),
    };
  }
  if (geometry.type === 'LineString') {
    return { type: 'LineString', points: geometry.coordinates.length };
  }
  if (geometry.type === 'Point') {
    return { type: 'Point', at: geometry.coordinates };
  }
  return { type: geometry.type };
}

/**
 * Is this ring axis-aligned — i.e. rasterized? The whole wind-swath question
 * in one number. A grid trace is nothing but horizontal and vertical edges;
 * a forecaster-drawn or interpolated shape is mostly neither.
 */
function axisAlignedShare(geometry) {
  const rings = [];
  if (geometry?.type === 'Polygon') rings.push(...geometry.coordinates);
  else if (geometry?.type === 'MultiPolygon')
    for (const p of geometry.coordinates) rings.push(...p);
  else return null;

  let axis = 0;
  let total = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const dx = Math.abs(ring[i + 1][0] - ring[i][0]);
      const dy = Math.abs(ring[i + 1][1] - ring[i][1]);
      if (dx < 1e-9 && dy < 1e-9) continue;
      total++;
      if (dx < 1e-9 || dy < 1e-9) axis++;
    }
  }
  if (!total) return null;
  return { edges: total, axisAligned: axis, share: +(axis / total).toFixed(3) };
}

/* ---------------------------------------------------------------------------
 * TRACK SHAPE — ?track=<bin>
 *
 * ==> THE QUESTION IT EXISTS TO ANSWER <==
 * `lib/trackline.js` joins the past track and the forecast track into ONE
 * smoothed line and then cuts it back in two at the seam. On 2026-07-29 the
 * dotted past half was drawing the WHOLE length — past AND forecast — on a
 * live storm (Genevieve, seen on glass by Aaron). Every step of that join was
 * read line by line and none of it can produce that result from the input it
 * is documented to receive. So the input is not what it is documented to be,
 * and there is exactly one way to find out which: read what NOAA actually
 * sends.
 *
 * WHAT IT REPORTS AND WHY EACH FIELD IS THERE:
 *   - `lines` per layer — `stitch` exists because a slot can hold several
 *     runs. If layer 11 arrives as one line the stitching is a no-op; if it
 *     arrives as many, their order and direction are in play.
 *   - `first` / `last` per line — the direction the source drew it. `orient`
 *     guesses this today, and a guess is only safe if the ends are far apart.
 *   - `pastReachesForecastEnd` — THE ONE THAT SETTLES IT. If the past track's
 *     own endpoint sits on the forecast's LAST point rather than its first,
 *     then layer 11 already contains the forecast and the join is behaving
 *     correctly on bad input. That is a different bug in a different file
 *     from the one the symptom points at.
 *
 * Degrees, not kilometres, and rounded to two places: this is read on a phone,
 * and a degree is the unit every constant in `TRACK_LINE` is already written
 * in (`joinEpsDeg`, `anchorMaxDeg`), so the numbers can be compared directly
 * against the thresholds that act on them without converting anything.
 * ------------------------------------------------------------------------- */

/**
 * Layer ids for the two track slots, DUPLICATED FROM `data/nhc-mapserver.js`
 * (`SUMMARY_LAYER`) because this runtime cannot import the app bundle — the
 * same call, for the same reason, as `KEEP_TECHS` in the TCGP relay. That file
 * is the truth and this mirrors it; if the ids move there and not here, this
 * probe reports confidently about the wrong layers.
 */
const TRACK_LAYER = Object.freeze({ pastTrack: 11, forecastTrack: 6 });

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const pt2 = (p) => (Array.isArray(p) ? [r2(p[0]), r2(p[1])] : null);

/** Every coordinate run in a feature's geometry, whichever way it is wrapped. */
function runsOf(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/** One run described by its size and its two ends — enough to see direction
 *  and enough to see overlap, without dumping a hundred coordinate pairs down
 *  a phone screen. */
const runShape = (run) => ({
  points: run.length,
  first: pt2(run[0]),
  last: pt2(run[run.length - 1]),
});

/** Flat degrees between two points. Deliberately NOT great-circle: every
 *  threshold this is compared against (`joinEpsDeg`, `anchorMaxDeg`) is itself
 *  a flat-degree number, and matching the maths the app actually runs matters
 *  more here than matching the planet. */
function sepDeg(a, b) {
  if (!a || !b) return null;
  return r2(Math.hypot(a[0] - b[0], a[1] - b[1]));
}

/**
 * Where the two layers meet, measured from EVERY past run.
 *
 * ==> MEASURING ONLY `pastRuns[0]` IS HOW THIS PROBE GOT ITS OWN QUESTION
 * WRONG THE FIRST TIME. <== NHC ships the past track as ONE LINE PER INTENSITY
 * CLASS — eleven of them on a mature storm — and nothing says which piece holds
 * the recent end. The first version compared the first piece's endpoints and
 * reported a 17.56° seam on a storm whose real seam was 3.48°, then answered
 * `pastReachesForecastEnd: false` with confidence. Wrong, and wrong in the
 * reassuring direction, which is the §5 failure this route exists to prevent.
 *
 * BOTH ENDS OF EVERY RUN, and the nearest wins. `orient` in lib/trackline.js
 * tries all four pairings itself and takes the smallest, so reporting anything
 * narrower than "the closest approach either way" would hide the case where a
 * pairing we did not expect is the one that wins.
 */
function seamReport(pastRuns, fcRuns) {
  if (!pastRuns.length || !fcRuns.length) return null;
  const fc = fcRuns[0];
  const fFirst = pt2(fc[0]);
  const fLast = pt2(fc[fc.length - 1]);

  const ends = pastRuns.flatMap((r) => [pt2(r[0]), pt2(r[r.length - 1])]);
  const nearest = (target) =>
    ends.reduce((best, p) => Math.min(best, sepDeg(p, target) ?? Infinity), Infinity);

  const toStart = nearest(fFirst);
  const toEnd = nearest(fLast);

  return {
    pastRunsMeasured: pastRuns.length,
    forecastStart: fFirst,
    forecastEnd: fLast,
    nearestPastEndToForecastStart: Number.isFinite(toStart) ? toStart : null,
    nearestPastEndToForecastEnd: Number.isFinite(toEnd) ? toEnd : null,
    /* True means layer 11 spans the forecast as well — a different bug, in a
     * different file, from the one the symptom points at. */
    pastReachesForecastEnd:
      Number.isFinite(toEnd) && Number.isFinite(toStart) && toEnd < toStart,
  };
}

/* SPEC §17 A2 — this route is gated. Read the guard's header for why it is
 * locked rather than deleted, and why the refusal is a 404. */
export async function onRequestGet(context) {
  /* THE GATE COMES FIRST — before parsing parameters and before any
   * upstream fetch, so an unauthorised caller never causes an outbound
   * request to NOAA or GDACS. That is the whole point (§17 A2). */
  const denied = guardInspect(context);
  if (denied) return denied;

  const url = new URL(context.request.url);
  const layerParam = url.searchParams.get('layer');
  const textParam = url.searchParams.get('text');
  const trackParam = url.searchParams.get('track');

  /* ANSWERED BEFORE THE try/catch AND BEFORE ANY UPSTREAM FETCH. This view is
   * for the case where the pipeline is suspect, so it must not depend on NOAA
   * being reachable to tell you what is in the store. */
  if (url.searchParams.get('warm') === '1') {
    try {
      return json(await warmStoreReport(context.env));
    } catch (e) {
      /* A KV read that throws is reported as itself, never as an empty store —
       * "no keys" and "could not ask" are different answers and §5's whole rule
       * is that they must never look the same. */
      return json({ binding: true, error: 'kv_list_failed', detail: String(e?.message || e) }, 502);
    }
  }

  try {
    /* Text product: report the RAW shape, not a cleaned-up reading of it. */
    if (textParam != null) {
      const bin = String(textParam).toUpperCase();
      if (!BIN_RE.test(bin)) {
        return json({ error: 'text must be a bin number like EP1 or AT2' }, 400);
      }
      const kind = String(url.searchParams.get('kind') || 'TCP').toUpperCase();
      const prefix = TEXT_KIND[kind];
      if (!prefix) {
        return json({ error: `kind must be one of ${Object.keys(TEXT_KIND).join(', ')}` }, 400);
      }

      /* The timestamp segment is a cache-buster (confirmed — see the note
       * above), so it is filled with the clock rather than an advisory time.
       * A probe wants the newest bytes every call. */
      const bust = String(Date.now()).slice(-6);
      const target = `${TEXT_HOST}/text/refresh/${prefix}${bin}+shtml/${bust}.shtml`;

      const r = await fetch(target, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain' },
      });
      const body = await r.text();

      return json({
        target,
        status: r.status,
        contentType: r.headers.get('Content-Type'),
        bytes: body.length,
        tagInventory: tagInventory(body),
        preBlocks: preBlocks(body),
        /* Raw head and tail, unmodified. If the product turns out NOT to be
         * in a <pre> at all, this is what shows where it actually lives. */
        rawHead: body.slice(0, 900),
        rawTail: body.slice(-500),
      });
    }

    /* Track shape: the two line layers for one storm, side by side. */
    if (trackParam != null) {
      const bin = String(trackParam).toUpperCase();
      const SERVICE = serviceFor(url);

      /* ==> A REFUSAL THAT HANDS BACK THE ANSWER. <==
       * Nobody knows a storm's bin number off the top of their head, and the
       * probe is read on a phone where a second request is a second round of
       * typing. So the only way to get this parameter wrong also lists every
       * value that would be right — `?track=list` is the intended spelling and
       * any other rubbish behaves the same. §5's recovery-action rule applied
       * to a developer tool: an error that cannot be acted on is a dead end. */
      if (!BIN_RE.test(bin)) {
        const params = new URLSearchParams({
          where: '1=1', outFields: '*', returnGeometry: 'false', f: 'geojson',
        });
        const fc = await getUpstream(`${SERVICE}/${TRACK_LAYER.pastTrack}/query?${params}`);
        const features = fc.features || [];
        const seen = new Map();
        for (const f of features) {
          const props = f.properties || {};
          const key = Object.keys(props).find((k) => k.toLowerCase() === 'binnumber');
          const nameKey = Object.keys(props).find((k) => k.toLowerCase() === 'stormname');
          const b = key ? props[key] : null;
          if (b && !seen.has(b)) seen.set(b, nameKey ? props[nameKey] : null);
        }
        return json({
          error: 'track must be a bin number like EP2 or AT1',
          liveBins: [...seen].map(([b, name]) => ({ bin: b, name })),
          /* Printed in case the field names above ever change — then the list
           * comes back empty and this is what says why, in the same response,
           * rather than in a second session. */
          propertyKeys: [
            ...new Set(features.flatMap((f) => Object.keys(f.properties || {}))),
          ].sort(),
        }, 400);
      }

      /* The SAME where clause the app sends (functions/api/nhc/mapserver.js).
       * A probe that filters differently from the app is measuring a different
       * question and would answer it confidently. `bin` has already passed
       * BIN_RE, so there is nothing here a quote could escape. */
      const where = `binnumber='${bin}'`;
      const params = new URLSearchParams({
        where,
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        f: 'geojson',
      });

      /* In parallel, and each one's failure kept separate: one dead layer must
       * not blank the other, exactly as the app's own bundle fetch works
       * (§5). A probe that reports nothing because half of it failed is the
       * silence rule broken in the tool built to enforce it. */
      const [pastRes, fcRes] = await Promise.allSettled(
        [TRACK_LAYER.pastTrack, TRACK_LAYER.forecastTrack].map((id) =>
          getUpstream(`${SERVICE}/${id}/query?${params}`)
        )
      );

      const shapeOf = (res) => {
        if (res.status !== 'fulfilled') {
          return { status: 'unavailable', detail: String(res.reason?.message || res.reason) };
        }
        const features = res.value.features || [];
        const runs = features.flatMap((f) => runsOf(f.geometry));
        return {
          status: 'ok',
          features: features.length,
          lines: runs.length,
          totalPoints: runs.reduce((n, r) => n + r.length, 0),
          shape: runs.slice(0, SAMPLE_LIMIT).map(runShape),
          /* One feature's properties, so the advisory stamp and any date field
           * on this layer is visible without a second request. */
          sampleProperties: features[0]?.properties ?? null,
        };
      };

      const past = shapeOf(pastRes);
      const forecast = shapeOf(fcRes);
      const pastRuns = pastRes.status === 'fulfilled'
        ? (pastRes.value.features || []).flatMap((f) => runsOf(f.geometry)) : [];
      const fcRuns = fcRes.status === 'fulfilled'
        ? (fcRes.value.features || []).flatMap((f) => runsOf(f.geometry)) : [];

      return json({
        service: SERVICE,
        bin,
        where,
        layers: { pastTrack: TRACK_LAYER.pastTrack, forecastTrack: TRACK_LAYER.forecastTrack },
        pastTrack: past,
        forecastTrack: forecast,
        seam: seamReport(pastRuns, fcRuns),
      });
    }

    /* No layer given: return the service's layer list. This is what names the
     * blocks and confirms which id a storm's wind layers actually sit at. */
    if (layerParam == null) {
      const SERVICE = serviceFor(url);
      const meta = await getUpstream(`${SERVICE}?f=json`);
      return json({
        service: SERVICE,
        layerCount: meta.layers?.length ?? 0,
        layers: (meta.layers || []).map((l) => ({
          id: l.id,
          name: l.name,
          group: Array.isArray(l.subLayerIds) && l.subLayerIds.length > 0,
        })),
      });
    }

    /* Guard: an integer id only. This is not a general-purpose proxy. */
    if (!/^\d+$/.test(layerParam)) {
      return json({ error: 'layer must be an integer' }, 400);
    }

    const where = url.searchParams.get('where') || '1=1';
    const wantGeometry = url.searchParams.get('geom') === '1';

    const params = new URLSearchParams({
      where,
      outFields: '*',
      returnGeometry: wantGeometry ? 'true' : 'false',
      outSR: '4326',
      f: 'geojson',
    });

    const fc = await getUpstream(`${serviceFor(url)}/${layerParam}/query?${params}`);
    const features = fc.features || [];

    return json({
      layer: Number(layerParam),
      where,
      featureCount: features.length,
      /* The union of property names across all features, which is the fastest
       * way to answer "what field carries the wind threshold" and "is there a
       * timestamp on these" without reading a full dump. */
      propertyKeys: [
        ...new Set(features.flatMap((f) => Object.keys(f.properties || {}))),
      ].sort(),
      sample: features.slice(0, SAMPLE_LIMIT).map((f) => ({
        properties: f.properties,
        geometry: wantGeometry ? ringSummary(f.geometry) : undefined,
        rasterized: wantGeometry ? axisAlignedShare(f.geometry) : undefined,
      })),
      truncated: features.length > SAMPLE_LIMIT,
    });
  } catch (e) {
    return json({ error: 'inspect_failed', detail: String(e?.message || e) }, 502);
  }
}
