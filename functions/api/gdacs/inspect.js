/**
 * /api/gdacs/inspect — READ-ONLY probe into GDACS.
 *
 * WHY THIS EXISTS. Same reason as its NHC sibling next door
 * (functions/api/nhc/inspect.js), which this file is modelled on exactly.
 * The cloud sandbox Andy works in cannot reach GDACS: its egress proxy
 * allowlists github.com and the package registries, and everything else
 * returns 403 `host_not_allowed` (re-confirmed 2026-07-24 against the event
 * list host). The DEPLOYED SITE can reach it, so it fetches on request and
 * reports what actually came back.
 *
 * WHAT IT IS FOR, specifically. GDACS has never had an inventory read in this
 * project — SPEC item 0a. Everything the spec asserts about it (Green/Orange/
 * Red polygons ARE the 34/50/64 kt bands; track lines group by intensity
 * rather than by time) is INHERITED FROM THE HA PROJECT and unverified here.
 * The NHC inventory, when finally read from the service itself, immediately
 * turned up a day-old bug and five unwired layers. Assume the same is waiting
 * here. Nothing in data/gdacs.js parses geometry today — the parser has to be
 * written from scratch, and it will be written against THIS report, not
 * against recollection.
 *
 * SAFE TO LEAVE DEPLOYED. It:
 *   - only ever GETs from one hardcoded GDACS host,
 *   - writes nothing, anywhere,
 *   - needs no secret,
 *   - returns metadata and truncated samples, not bulk geometry.
 * The worst it can do is make GDACS requests, which the site already makes.
 *
 * USAGE:
 *   /api/gdacs/inspect                    → the event list: fields + TC events
 *   /api/gdacs/inspect?event=1102371      → that event's geometry, described
 *   /api/gdacs/inspect?event=...&episode=12
 *   /api/gdacs/inspect?event=...&class=Poly_Green   → one band only
 *   /api/gdacs/inspect?event=...&class=Poly_Green&dump=1 → RAW rings, full
 *        precision, replayable straight into lib/bandmerge.js
 *   /api/gdacs/inspect?event=...&raw=1    → the geometry URL probe table only
 *
 * Deliberately NOT a general proxy: the host is fixed, and `event`/`episode`
 * must be plain integers, so this cannot be pointed at arbitrary URLs.
 */

const HOST = 'https://www.gdacs.org';
const EVENT_LIST = `${HOST}/gdacsapi/api/Events/geteventlist/EVENTS4APP`;

/** Be a good citizen and be identifiable in GDACS's logs. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** How many features to describe in full. A storm returning three wind-band
 *  polygons is the interesting case; eighty-five would be noise. */
const SAMPLE_LIMIT = 14;

/** Per-request ceiling. The spec calls this endpoint slow and flaky on
 *  inherited evidence, then measured 375–984 ms when probed once. Measuring
 *  it honestly is one of this report's four jobs, so the timeout is generous
 *  enough that a slow-but-working response reads as slow, not as broken. */
const TIMEOUT_MS = 25000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });

/**
 * GET with a timeout, returning timing and status rather than throwing on a
 * bad status. The URL-shape probe below needs to see 404s as DATA — "this
 * candidate URL is wrong" is the finding, not an error.
 */
async function timedGet(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctl.signal,
    });
    const text = await r.text();
    let body = null;
    let parseError = null;
    try {
      body = JSON.parse(text);
    } catch (e) {
      parseError = String(e?.message || e);
    }
    return {
      ok: r.ok,
      status: r.status,
      ms: Date.now() - t0,
      bytes: text.length,
      contentType: r.headers.get('Content-Type') || null,
      body,
      parseError,
      /* Only useful when the body did not parse — enough to see whether GDACS
       * handed back an HTML error page rather than JSON. */
      head: body ? undefined : text.slice(0, 200),
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      ms: Date.now() - t0,
      error: e?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : String(e?.message || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Count coordinates in a GeoJSON geometry without dumping them all. The
 *  point budget question: if GDACS polygons are enormous we need to know now,
 *  not when the globe stutters on a phone. */
function ringSummary(geometry) {
  if (!geometry) return null;
  const t = geometry.type;
  if (t === 'Polygon') {
    return { type: t, rings: geometry.coordinates.map((r) => r.length) };
  }
  if (t === 'MultiPolygon') {
    return {
      type: t,
      parts: geometry.coordinates.length,
      rings: geometry.coordinates.map((p) => p.map((r) => r.length)),
    };
  }
  if (t === 'LineString') {
    return { type: t, points: geometry.coordinates.length };
  }
  if (t === 'MultiLineString') {
    return { type: t, parts: geometry.coordinates.map((l) => l.length) };
  }
  if (t === 'Point') {
    return { type: t, at: geometry.coordinates };
  }
  return { type: t };
}

/** Total coordinate count, for the simplification budget. */
function pointCount(geometry) {
  const c = geometry?.coordinates;
  if (!c) return 0;
  let n = 0;
  const walk = (a) => {
    if (!Array.isArray(a)) return;
    if (typeof a[0] === 'number') { n++; return; }
    for (const x of a) walk(x);
  };
  walk(c);
  return n;
}

/**
 * Describe a value compactly. Sample reports need to show the SHAPE of a
 * field without pasting a 40 kB polygon into the output Aaron has to read.
 */
function describe(v, depth = 0) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 120)}… (${v.length} chars)` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    if (depth >= 1) return `[array, ${v.length} items]`;
    return v.slice(0, 3).map((x) => describe(x, depth + 1));
  }
  if (typeof v === 'object') {
    if (depth >= 1) return `{object: ${Object.keys(v).slice(0, 12).join(', ')}}`;
    const out = {};
    for (const k of Object.keys(v).slice(0, 20)) out[k] = describe(v[k], depth + 1);
    return out;
  }
  return String(v);
}

/**
 * Rough geographic area of a polygon, in square degrees.
 *
 * THIS IS THE INDEPENDENT CHECK, and it is the whole reason this function
 * exists. The mapping question — does Poly_Green/Orange/Red mean 34/50/64 kt —
 * cannot be settled by reading a color name, because `alertlevel` on this
 * same feed already uses those three words to mean humanitarian impact
 * (SPEC §4). Two meanings, one vocabulary.
 *
 * Physics settles it instead. Wind bands NEST by construction: the 34 kt
 * ring is the widest because tropical-storm-force wind reaches furthest from
 * the centre, and the 64 kt core sits inside it. So if the three classes are
 * thresholds, their areas MUST come out strictly ordered — Green widest,
 * Red smallest — and if they don't, the inherited story is wrong and we find
 * out from geometry rather than from a label we hoped meant something.
 *
 * The shoelace formula on raw lon/lat is crude (degrees of longitude shrink
 * toward the poles) but the comparison is between polygons around the SAME
 * storm at the same latitude, so the distortion is common to all three and
 * cancels out of the ordering. Ranking is all this needs to do.
 */
function areaSqDeg(geometry) {
  const rings = [];
  if (geometry?.type === 'Polygon') rings.push(...geometry.coordinates);
  else if (geometry?.type === 'MultiPolygon')
    for (const p of geometry.coordinates) rings.push(...p);
  else return null;

  let total = 0;
  for (const ring of rings) {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    total += Math.abs(a / 2);
  }
  return +total.toFixed(4);
}

/** Bounding box, as a second read on size that does not depend on ring
 *  winding or on the shoelace sum being well-formed. */
function bbox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (a) => {
    if (!Array.isArray(a)) return;
    if (typeof a[0] === 'number') {
      if (a[0] < minX) minX = a[0];
      if (a[0] > maxX) maxX = a[0];
      if (a[1] < minY) minY = a[1];
      if (a[1] > maxY) maxY = a[1];
      return;
    }
    for (const x of a) walk(x);
  };
  walk(geometry?.coordinates);
  if (!Number.isFinite(minX)) return null;
  return {
    widthDeg: +(maxX - minX).toFixed(3),
    heightDeg: +(maxY - minY).toFixed(3),
  };
}

/**
 * The census: EVERY feature, grouped by `Class`, with only the short
 * identifying fields.
 *
 * The first report sampled 14 of 33 polygons and they came back near-
 * identical, which told us nothing — the distinguishing fields were in the
 * 19 we never saw, and the nested objects were truncated on top of that.
 * That was my bug. This replaces sampling with a complete census: the fields
 * below are all short strings and numbers, so all 44 features cost less
 * output than the old truncated 14 did.
 */
function classCensus(features) {
  const groups = new Map();

  for (const f of features) {
    const p = f?.properties || {};
    const cls = p.Class ?? '(no Class)';
    if (!groups.has(cls)) {
      groups.set(cls, {
        count: 0,
        geometryTypes: new Set(),
        featuretype: new Set(),
        polygonlabel: new Set(),
        polygondate: new Set(),
        forecast: new Set(),
        visible: new Set(),
        key: new Set(),
        coordinates: [],
        areas: [],
        boxes: [],
      });
    }
    const g = groups.get(cls);
    g.count++;
    g.geometryTypes.add(f?.geometry?.type || 'null');
    if (p.featuretype != null) g.featuretype.add(String(p.featuretype));
    if (p.polygonlabel != null) g.polygonlabel.add(String(p.polygonlabel));
    if (p.polygondate != null) g.polygondate.add(String(p.polygondate));
    if (p.forecast != null) g.forecast.add(String(p.forecast));
    if (p.visible != null) g.visible.add(String(p.visible));
    if (p.key != null) g.key.add(String(p.key));
    g.coordinates.push(pointCount(f?.geometry));
    const a = areaSqDeg(f?.geometry);
    if (a != null) g.areas.push(a);
    const b = bbox(f?.geometry);
    if (b) g.boxes.push(b);
  }

  const out = {};
  for (const [cls, g] of groups) {
    const areas = g.areas.sort((x, y) => x - y);
    out[cls] = {
      count: g.count,
      geometryTypes: [...g.geometryTypes],
      featuretype: [...g.featuretype],
      /* Full strings, untruncated. These are the fields that name a band. */
      polygonlabel: [...g.polygonlabel],
      polygondate: [...g.polygondate].sort(),
      forecast: [...g.forecast],
      visible: [...g.visible],
      key: [...g.key].slice(0, 8),
      coordinates: {
        total: g.coordinates.reduce((s, n) => s + n, 0),
        min: Math.min(...g.coordinates),
        max: Math.max(...g.coordinates),
      },
      /* The nesting test. Compare these across the three Poly_* classes. */
      areaSqDeg: areas.length
        ? { min: areas[0], median: areas[Math.floor(areas.length / 2)], max: areas[areas.length - 1] }
        : null,
      bboxDeg: g.boxes.length ? g.boxes[0] : null,
    };
  }
  return out;
}

/**
 * The severity block, in full and untruncated.
 *
 * It came back cut off mid-string last time (`describe()` collapses nested
 * objects at depth 1, which is right for a 40 kB polygon and wrong for a
 * three-field object carrying the one wind number in the payload). It is
 * small; it gets printed whole.
 */
function severityVariants(features) {
  const seen = new Map();
  for (const f of features) {
    const s = f?.properties?.severitydata;
    if (!s) continue;
    const k = JSON.stringify(s);
    if (!seen.has(k)) seen.set(k, s);
  }
  return [...seen.values()];
}

/** Union of property names across features — the fastest way to answer "what
 *  field carries the wind threshold" without reading a full dump. */
const unionKeys = (features) =>
  [...new Set(features.flatMap((f) => Object.keys(f?.properties || {})))].sort();

/**
 * The threshold hunt. This is the single most important question in the
 * report: which property on a wind-band polygon identifies whether it is the
 * 34, 50, or 64 kt band?
 *
 * The spec's inherited claim is that the ALERT COLOR (Green/Orange/Red) does
 * double duty as the threshold marker. That claim is exactly what needs
 * checking, because on the event list `alertlevel` means humanitarian impact,
 * NOT intensity (SPEC §4, non-negotiable) — and if GDACS reuses the same word
 * for two different meanings, reading one as the other paints a Cat-3 ring in
 * a tropical-storm color. So: report every property whose NAME or VALUE looks
 * threshold-ish, and let the numbers decide rather than the inherited story.
 */
const THRESHOLD_HINT = /(wind|speed|knot|kt|kmh|km_h|severity|class|level|alert|colou?r|threshold|radi|band|intensity|category|force|beaufort|label|name|descr|title|type)/i;

/* GDACS is known to bury the number inside a human-readable string
 * ("Wind speed 120 km/h") rather than exposing it as its own numeric field.
 * A key-name match alone would miss that, so values are sniffed too. */
const VALUE_HINT = /(\d+\s*(kt|kn|knot|km\/?h|mph)|wind|green|orange|red)/i;

function thresholdCandidates(features) {
  const byKey = new Map();
  for (const f of features) {
    for (const [k, v] of Object.entries(f?.properties || {})) {
      const looksRelevant =
        THRESHOLD_HINT.test(k) ||
        (typeof v === 'string' && VALUE_HINT.test(v)) ||
        (typeof v === 'number' && [34, 50, 64, 63, 118, 178].includes(v));
      if (!looksRelevant) continue;
      if (!byKey.has(k)) byKey.set(k, new Set());
      const set = byKey.get(k);
      if (set.size < 12) set.add(typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v));
    }
  }
  return Object.fromEntries([...byKey].map(([k, s]) => [k, [...s]]));
}

/** Does any property carry a parseable time? The "grouped by intensity, not
 *  time" claim is the one the spec most wants re-checked. */
const TIME_HINT = /(date|time|dtg|synop|from|to|stamp|utc|hour|step|tau)/i;

function timeCandidates(features) {
  const byKey = new Map();
  for (const f of features) {
    for (const [k, v] of Object.entries(f?.properties || {})) {
      if (!TIME_HINT.test(k)) continue;
      if (v === null || typeof v === 'object') continue;
      const parsed = Number.isFinite(Date.parse(String(v)));
      if (!byKey.has(k)) byKey.set(k, { parsesAsDate: parsed, samples: new Set() });
      const e = byKey.get(k);
      if (e.samples.size < 8) e.samples.add(String(v));
    }
  }
  return Object.fromEntries(
    [...byKey].map(([k, e]) => [k, { parsesAsDate: e.parsesAsDate, samples: [...e.samples] }])
  );
}

/** Group features by geometry type, so "58 polygons, 26 lines, 1 point" comes
 *  out without reading every sample. */
function geometryBreakdown(features) {
  const counts = {};
  let totalPoints = 0;
  let biggest = 0;
  for (const f of features) {
    const t = f?.geometry?.type || 'null';
    counts[t] = (counts[t] || 0) + 1;
    const n = pointCount(f?.geometry);
    totalPoints += n;
    if (n > biggest) biggest = n;
  }
  return { byType: counts, totalCoordinates: totalPoints, largestFeatureCoordinates: biggest };
}

/**
 * Candidate geometry URLs.
 *
 * WHY A PROBE TABLE AND NOT ONE URL: the geometry endpoint was exercised
 * during the 2026-07-23 probe (SPEC §4 records its TIMING — 375–984 ms, 85
 * features) but THE URL ITSELF WAS NEVER WRITTEN DOWN, in the spec or in
 * config/constants.js. Picking one from memory and presenting it as the
 * endpoint is precisely the "unverified inference as confirmed fact" failure.
 * So all plausible forms get tried and the report says which actually
 * answered. The winner gets recorded in constants.js and this list dies.
 */
function candidateGeometryUrls(eventId, episodeId) {
  const ep = episodeId ? String(episodeId) : null;
  const urls = [
    `${HOST}/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=${eventId}${ep ? `&episodeid=${ep}` : ''}`,
    `${HOST}/gdacsapi/api/events/geteventdata?eventtype=TC&eventid=${eventId}${ep ? `&episodeid=${ep}` : ''}`,
    `${HOST}/datareport/resources/TC/${eventId}/geojson_${eventId}_${ep || '1'}.geojson`,
    `${HOST}/contentdata/resources/TC/${eventId}/geojson_${eventId}_${ep || '1'}.geojson`,
  ];
  return [...new Set(urls)];
}

/** Pull a FeatureCollection out of whatever wrapper GDACS used. */
function featuresOf(body) {
  if (Array.isArray(body?.features)) return body.features;
  for (const k of Object.keys(body || {})) {
    if (Array.isArray(body[k]?.features)) return body[k].features;
  }
  return null;
}

/* ---------------------------------------------------------------- event list */

async function inspectEventList() {
  const r = await timedGet(EVENT_LIST);
  if (!r.ok || !r.body) {
    return json(
      { error: 'event_list_failed', url: EVENT_LIST, status: r.status, ms: r.ms, detail: r.error || r.parseError, head: r.head },
      502
    );
  }

  const all = featuresOf(r.body) || [];
  const tc = all.filter((f) => (f?.properties?.eventtype || '') === 'TC');

  return json({
    what: 'GDACS event list',
    url: EVENT_LIST,
    timing: { ms: r.ms, bytes: r.bytes, contentType: r.contentType },
    topLevelKeys: Object.keys(r.body || {}),
    featureCount: all.length,
    tropicalCycloneCount: tc.length,

    /* Job 1: the feed's REAL field names, and which carry alert level, wind,
     * and the affected-country list. data/gdacs.js reads eventid, eventname,
     * severitydata.severity, alertlevel, episodeid, country, fromdate/todate
     * on inherited authority. This confirms or kills each one. */
    propertyKeys: unionKeys(tc.length ? tc : all),

    /* The active TC roster, with the ids needed for the geometry pass below.
     * Aaron picks the strongest storm here and re-opens with ?event=. */
    tropicalCyclones: tc.slice(0, SAMPLE_LIMIT).map((f) => {
      const p = f.properties || {};
      return {
        eventid: p.eventid ?? null,
        episodeid: p.episodeid ?? null,
        name: p.eventname ?? p.name ?? null,
        alertlevel: p.alertlevel ?? null,
        /* Whole, not describe()d: this three-field object carries the only
         * wind magnitude GDACS publishes, and collapsing it cost us a round
         * trip the first time. */
        severitydata: p.severitydata ?? null,
        fromdate: p.fromdate ?? null,
        todate: p.todate ?? null,
        country: describe(p.country),
        geometry: ringSummary(f.geometry),
        /* Whether the list itself advertises a geometry/detail link. If GDACS
         * publishes the URL, we do not have to guess it at all. */
        urlish: Object.fromEntries(
          Object.entries(p).filter(
            ([k, v]) => /url|link|href|report|geom|map/i.test(k) && v
          ).map(([k, v]) => [k, describe(v)])
        ),
      };
    }),

    /* One complete TC record, shape-described. The union of keys says what
     * exists; this says what the values look like. */
    fullSampleEvent: tc.length ? describe(tc[0].properties) : null,

    next: tc.length
      ? `Open /api/gdacs/inspect?event=${tc[0].properties?.eventid}&episode=${tc[0].properties?.episodeid ?? ''}`
      : 'No active tropical cyclones right now — the geometry pass needs a live storm.',
  });
}

/* ------------------------------------------------------------------ geometry */

/**
 * RAW COORDINATE DUMP — the honest end of the guessing.
 *
 * Every band-shape bug so far (the beading, the wedge, and whatever is still
 * pinching the ends) was diagnosed against SYNTHETIC fixtures: circles and
 * smooth blobs standing in for real GDACS bands. Three consecutive wrong
 * diagnoses came out of that, and every fixture passed on the buggy code —
 * which should have been the signal after the first. Real bands are quadrant
 * shapes with concave notches, and they carry something the approximations
 * do not, including (per Aaron's read of the map) forecast points where a
 * band is simply ABSENT.
 *
 * This returns the actual rings at full precision, in a form that replays
 * straight into lib/bandmerge.js offline. Same read-only contract as the
 * rest of this file — one hardcoded host, writes nothing, no secret — just
 * without the summarising that was hiding the thing we needed to see.
 */
function rawDump(features, classFilter) {
  const out = [];
  for (const f of features) {
    const p = f?.properties || {};
    const g = f?.geometry;
    if (!g) continue;
    out.push({
      Class: p.Class ?? null,
      featuretype: p.featuretype ?? null,
      polygonlabel: p.polygonlabel ?? null,
      polygondate: p.polygondate ?? null,
      key: p.key ?? null,
      type: g.type,
      /* Full precision, no rounding: a replay has to see exactly what the
       * browser sees or it proves nothing. */
      coordinates: g.coordinates,
    });
  }
  return {
    what: 'GDACS raw geometry dump',
    classFilter: classFilter || null,
    featureCount: out.length,
    note: 'Replay directly into lib/bandmerge.js. Full precision, unmodified.',
    features: out,
  };
}

async function inspectGeometry(eventId, episodeId, rawOnly, classFilter, dump) {
  const candidates = candidateGeometryUrls(eventId, episodeId);

  /* Sequential on purpose. Job 4 is measuring latency honestly, and four
   * parallel requests to a source the spec calls flaky would both distort the
   * timings and be rude to a public-good endpoint. */
  const probe = [];
  let winner = null;
  for (const url of candidates) {
    const r = await timedGet(url);
    const feats = r.ok && r.body ? featuresOf(r.body) : null;
    probe.push({
      url,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes ?? null,
      contentType: r.contentType ?? null,
      parsedJson: !!r.body,
      featureCount: feats ? feats.length : null,
      error: r.error || r.parseError || undefined,
      head: r.head,
    });
    if (!winner && feats && feats.length) winner = { url, body: r.body, features: feats, timing: r };
  }

  if (rawOnly || !winner) {
    return json({
      what: 'GDACS geometry URL probe',
      eventid: eventId,
      episodeid: episodeId ?? null,
      /* A probe table where every row failed IS the finding: it means the URL
       * form is not among the four we knew about, and the next move is to
       * read a link off the event list rather than guess a fifth. */
      resolved: winner ? winner.url : null,
      probe,
      note: winner
        ? 'Re-open without raw=1 for the full description.'
        : 'No candidate returned features. Check the event list output for a published geometry/report link (the "urlish" block).',
    }, winner ? 200 : 502);
  }

  const all = winner.features;
  /* Optional narrowing to one Class, for drilling into a single band without
   * the other 40 features in the way. Substring match, case-insensitive, so
   * `?class=green` finds `Poly_Green`. */
  const features = classFilter
    ? all.filter((f) => String(f?.properties?.Class ?? '').toLowerCase().includes(classFilter.toLowerCase()))
    : all;
  /* Raw dump short-circuits everything below: no summarising, no sampling,
   * just the rings. This is the path that replaces inventing fixtures. */
  if (dump) return json(rawDump(features, classFilter));

  const polys = features.filter((f) => /Polygon/.test(f?.geometry?.type || ''));
  const lines = features.filter((f) => /LineString/.test(f?.geometry?.type || ''));
  const points = features.filter((f) => f?.geometry?.type === 'Point');

  return json({
    what: 'GDACS per-event geometry',
    eventid: eventId,
    episodeid: episodeId ?? null,

    /* Job 4: real latency, from Cloudflare's edge. Still not a phone on cell
     * data — say so rather than let this read as the final word. */
    resolvedUrl: winner.url,
    timing: {
      ms: winner.timing.ms,
      bytes: winner.timing.bytes,
      note: 'Measured from the Cloudflare edge, not from a phone on cell data.',
    },
    probe,

    topLevelKeys: Object.keys(winner.body || {}),
    featureCount: features.length,
    classFilter: classFilter || null,

    /* Job 2 and the point budget, together. */
    geometry: geometryBreakdown(features),
    propertyKeys: unionKeys(features),

    /* THE ANSWER TO THE MAPPING QUESTION. Every feature, grouped by Class,
     * with full labels and — decisively — polygon AREA. If Poly_Green /
     * Poly_Orange / Poly_Red are the 34/50/64 kt bands they must nest:
     * Green largest area, Red smallest. If they don't nest, the inherited
     * claim is dead and the colors mean something else entirely. */
    classCensus: classCensus(features),

    /* Was truncated mid-string last time. Printed whole now — it carries the
     * only wind magnitude GDACS publishes. */
    severitydata: severityVariants(features),

    /* Job 2, secondary: name-or-value matches across all properties. */
    thresholdCandidates: thresholdCandidates(features),

    /* Job 3: does anything here carry a usable time? If polygons carry
     * distinct timestamps they arrive PER-TIMESTEP and a swath has to be
     * built by merging them; if they do not, they arrive MERGED and the
     * spec's "one radius, symmetric about the track" story holds. */
    timeCandidates: timeCandidates(features),

    breakdown: {
      polygons: polys.length,
      lines: lines.length,
      points: points.length,
    },

    /* Track lines: the inherited claim is that they group BY INTENSITY, not
     * by time. Every line in the last report had exactly 2 points, which
     * looks more like per-segment chronology than intensity grouping — so
     * the endpoints and any date go out in full for all of them. */
    lines: lines.map((f) => ({
      class: f.properties?.Class ?? null,
      label: f.properties?.polygonlabel ?? null,
      date: f.properties?.polygondate ?? null,
      points: pointCount(f.geometry),
      coords: f.geometry?.coordinates,
    })),

    pointSample: points.slice(0, 4).map((f) => ({
      class: f.properties?.Class ?? null,
      label: f.properties?.polygonlabel ?? null,
      date: f.properties?.polygondate ?? null,
      geometry: ringSummary(f.geometry),
    })),
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const event = url.searchParams.get('event');
  const episode = url.searchParams.get('episode');
  const rawOnly = url.searchParams.get('raw') === '1';
  const classFilter = url.searchParams.get('class');
  const dump = url.searchParams.get('dump') === '1';

  try {
    if (event == null || event === '') return await inspectEventList();

    /* Guard: integers only. This is not a general-purpose proxy. */
    if (!/^\d+$/.test(event)) return json({ error: 'event must be an integer' }, 400);
    if (episode && !/^\d+$/.test(episode)) {
      return json({ error: 'episode must be an integer' }, 400);
    }
    /* The class filter is compared against data we fetched, never sent
     * upstream, but keep it to a sane token anyway. */
    if (classFilter && !/^[A-Za-z0-9_ -]{1,40}$/.test(classFilter)) {
      return json({ error: 'class must be a simple token' }, 400);
    }

    return await inspectGeometry(event, episode || null, rawOnly, classFilter, dump);
  } catch (e) {
    return json({ error: 'inspect_failed', detail: String(e?.message || e) }, 502);
  }
}
