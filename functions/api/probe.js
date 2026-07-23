/**
 * /api/probe — TEMPORARY BUILD SCAFFOLDING. NOT PRODUCT. DELETE AFTER PHASE 4.
 *
 * WHY THIS EXISTS: the cloud sandbox Andy works in sits behind an egress proxy
 * with a fixed domain allowlist. github.com is on it; nhc.noaa.gov,
 * mapservices.weather.noaa.gov and gdacs.org are not, so every request to them
 * dies at the proxy with a 403 before it leaves. That makes it impossible to
 * probe the live feeds from the sandbox and clear SPEC §4's [VERIFY] flags.
 *
 * Cloudflare has no such restriction. So: this Function fetches the upstream
 * endpoints from the edge and COMMITS THE RAW RESPONSES to probes/ in the repo.
 * Andy then reads them via an ordinary git pull. Every leg of that path uses a
 * route that already works; nothing about the sandbox network changes.
 *
 * SCOPE DISCIPLINE: this is build-time scaffolding to answer questions, listed
 * as a temporary fixture in SPEC §15. It is not part of the app, nothing in the
 * client calls it, and it gets deleted along with probes/ once the [VERIFY]
 * flags are facts. If you are reading this after Phase 4 shipped, delete it.
 *
 * SETUP (both in Cloudflare Pages -> Settings -> Environment variables):
 *   PROBE_GH_TOKEN  fine-grained PAT, Contents read/write on landfall only
 *   PROBE_SECRET    any long random string; required as ?key= on every call
 *
 * SECURITY: this endpoint holds a credential that can WRITE TO THE REPO. It is
 * therefore secret-gated. A wrong or missing key returns 404, not 403 — a 403
 * confirms the endpoint exists, which a 404 does not. Both env vars are read
 * server-side and never reach the client. Responses never echo either one.
 *
 * Self-contained on purpose, same as the other Functions: Pages Functions run
 * in their own workerd runtime and importing config/ would couple a static
 * deploy to a bundler step this project deliberately does not have.
 */

const OWNER = 'aaronmayeux';
const REPO = 'landfall';
const BRANCH = 'main';

/** NHC tropical MapServer (SPEC §4). Browser-fetchable directly — no relay. */
const MAPSERVER =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

/** NOAA 403s requests with no User-Agent. Identify the app honestly — SPEC §15
 *  scale-pass note: these are public-good endpoints, not free infrastructure. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** GDACS geometry was slow and flaky on the HA project (needed 90 s there).
 *  A probe that hangs forever is useless, so every upstream fetch is bounded
 *  and a timeout is recorded as a RESULT, not thrown away — "this endpoint is
 *  too slow to use" is exactly the kind of finding this probe exists to make. */
const UPSTREAM_TIMEOUT_MS = 25000;

const json = (status, obj) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

/** Fetch one upstream URL, capturing everything a probe needs to be conclusive:
 *  status, headers, timing, and the body — success or failure. A probe that
 *  only records successes cannot tell "endpoint is broken" from "never ran." */
async function probeOne(label, url) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, */*' },
      signal: controller.signal,
    });
    const body = await r.text();
    clearTimeout(timer);

    /* Record whether the body actually parses. An ArcGIS MapServer happily
     * returns HTTP 200 with an error object inside, and a text/html error page
     * would otherwise be filed as a successful probe. */
    let parses = false;
    let parsedNote = null;
    try {
      const p = JSON.parse(body);
      parses = true;
      if (p && typeof p === 'object' && p.error) {
        parsedNote = `upstream returned a JSON error object: ${JSON.stringify(p.error).slice(0, 300)}`;
      }
    } catch (e) {
      parsedNote = `body is not JSON: ${String(e.message).slice(0, 200)}`;
    }

    return {
      label,
      url,
      ok: r.ok,
      status: r.status,
      elapsedMs: Date.now() - startedAt,
      contentType: r.headers.get('Content-Type'),
      /* CORS ground truth (SPEC §4) — whether the browser could fetch this
       * DIRECTLY, skipping the relay. Recorded from the edge, so treat it as a
       * strong hint to be confirmed in a real browser, not as final proof. */
      accessControlAllowOrigin: r.headers.get('Access-Control-Allow-Origin'),
      bodyBytes: body.length,
      parses,
      note: parsedNote,
      body,
    };
  } catch (e) {
    clearTimeout(timer);
    const aborted = e.name === 'AbortError';
    return {
      label,
      url,
      ok: false,
      status: null,
      elapsedMs: Date.now() - startedAt,
      error: aborted ? `timed out after ${UPSTREAM_TIMEOUT_MS} ms` : String(e.message || e),
      body: null,
    };
  }
}

/** Commit one file to GitHub via the Contents API. Reads the existing blob sha
 *  first because an update requires it; absent (404) means create. */
async function commitFile(token, path, contentString, message) {
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let sha;
  const existing = await fetch(`${api}?ref=${BRANCH}`, { headers: ghHeaders });
  if (existing.ok) {
    const meta = await existing.json();
    sha = meta.sha;
  } else if (existing.status !== 404) {
    throw new Error(`github read failed: HTTP ${existing.status}`);
  }

  /* Base64 for the Contents API. btoa is byte-oriented, so UTF-8 has to be
   * encoded first or any non-ASCII character in a storm name throws. */
  const bytes = new TextEncoder().encode(contentString);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const content = btoa(binary);

  const put = await fetch(api, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });

  if (!put.ok) {
    const detail = await put.text();
    throw new Error(`github write failed: HTTP ${put.status} ${detail.slice(0, 300)}`);
  }
  return path;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  /* Secret gate. 404 on failure so the endpoint does not announce itself. */
  const secret = env.PROBE_SECRET;
  if (!secret || url.searchParams.get('key') !== secret) {
    return new Response('Not found', { status: 404 });
  }

  const token = env.PROBE_GH_TOKEN;
  if (!token) {
    return json(500, {
      error: 'probe_not_configured',
      detail: 'PROBE_GH_TOKEN is not set in Cloudflare Pages environment variables.',
    });
  }

  /* STAGE 1 — the feeds. Everything downstream needs live storm ids, so these
   * run first and the rest of the pass is built from what they return. */
  const stage1 = [
    ['nhc-currentstorms', 'https://www.nhc.noaa.gov/CurrentStorms.json'],
    [
      'nhc-mapserver-catalogue',
      `${MAPSERVER}?f=json`,
    ],
    [
      'gdacs-eventlist',
      'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP',
    ],
  ];

  const results = [];
  for (const [label, target] of stage1) {
    results.push(await probeOne(label, target));
  }

  /* STAGE 2 — per-storm targets, derived from stage 1 rather than hardcoded, so
   * this probe stays useful next week with different storms on the board.
   *
   * Slot lookup uses binNumber ("AT2", "EP1"), which the feed hands us directly.
   * Confirmed against the live catalogue: block starts AT=4 EP=134 CP=264, and
   * layer id = block + (slot-1)*26 + offset. */
  const BLOCK_BY_BASIN = { AT: 4, EP: 134, CP: 264 };

  /** Offsets within a storm's 26-layer block, confirmed against the live
   *  catalogue 2026-07-23. These are the Phase 4 geometry layers. */
  const LAYER_OFFSETS = {
    'forecast-points': 2,
    'forecast-track': 3,
    'cone': 4,
    'watch-warning': 5,
    'past-points': 7,
    'past-track': 8,
    'forecast-wind-radii': 12,
    'advisory-wind-field': 13,
  };

  const stage2 = [];
  const derived = { storms: [], gdacsGeometry: [] };

  const stormsProbe = results.find((r) => r.label === 'nhc-currentstorms');
  if (stormsProbe?.body) {
    try {
      const feed = JSON.parse(stormsProbe.body);
      for (const s of feed.activeStorms || []) {
        const bin = String(s.binNumber || '');
        const basin = bin.slice(0, 2).toUpperCase();
        const slot = parseInt(bin.slice(2), 10);
        const block = BLOCK_BY_BASIN[basin];
        if (!block || !Number.isFinite(slot)) continue;

        const base = block + (slot - 1) * 26;
        const tag = `${s.id}-${bin}`;
        derived.storms.push({ id: s.id, name: s.name, binNumber: bin, base });

        for (const [name, off] of Object.entries(LAYER_OFFSETS)) {
          const layerId = base + off;

          /* Layer METADATA: this is where a per-layer advisory number or
           * issuance timestamp would live, if one exists. SPEC §4's
           * geometry-lag rule depends on the answer. */
          stage2.push([
            `layer-meta/${tag}-${name}-${layerId}`,
            `${MAPSERVER}/${layerId}?f=json`,
          ]);

          /* Layer GEOJSON: does f=geojson actually return usable geometry, and
           * what properties ride along? One live query per layer type is the
           * only way to know before Phase 4 codes against it. */
          stage2.push([
            `layer-geojson/${tag}-${name}-${layerId}`,
            `${MAPSERVER}/${layerId}/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson`,
          ]);
        }
      }
    } catch (e) {
      derived.stormsParseError = String(e.message || e);
    }
  }

  /* GDACS per-event geometry — the endpoint that needed a 90 s timeout on the
   * HA project. Each event carries its own geometry url; probe the TC ones. */
  const gdacsProbe = results.find((r) => r.label === 'gdacs-eventlist');
  if (gdacsProbe?.body) {
    try {
      const fc = JSON.parse(gdacsProbe.body);
      for (const f of fc.features || []) {
        const p = f.properties || {};
        if (p.eventtype !== 'TC') continue;
        const geomUrl = p.url?.geometry;
        if (!geomUrl) continue;
        derived.gdacsGeometry.push({
          eventid: p.eventid, episodeid: p.episodeid, eventname: p.eventname,
        });
        stage2.push([`gdacs-geometry/${p.eventid}-ep${p.episodeid}`, geomUrl]);
      }
    } catch (e) {
      derived.gdacsParseError = String(e.message || e);
    }
  }

  /* Sequential on purpose. These are public-good endpoints (SPEC §15) and a
   * burst of parallel requests from one IP is exactly the poll storm that note
   * warns against. Slower probe, better citizenship.
   *
   * BUDGETED: stage 2 is ~50 targets and a Worker has a finite wall clock. If
   * the budget runs out we STOP PROBING AND GO WRITE what we have — a partial
   * result that says which targets were skipped beats dying before the commit
   * phase and leaving nothing at all. Skipped targets are recorded explicitly
   * so a partial run can never be mistaken for a complete one. */
  const STAGE2_BUDGET_MS = 60000;
  const stage2Start = Date.now();
  const skipped = [];

  for (const [label, target] of stage2) {
    if (Date.now() - stage2Start > STAGE2_BUDGET_MS) {
      skipped.push(label);
      continue;
    }
    results.push(await probeOne(label, target));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const written = [];
  const writeErrors = [];

  /* Bodies are GROUPED into a few bundle files rather than committed one-per-
   * probe. Round two runs ~50 targets, and 50 sequential GitHub round-trips
   * would very likely exhaust the Worker's time budget partway through — which
   * leaves a HALF-WRITTEN folder that looks complete. It would also bury the
   * repo history under 50 commits for a single probe run. Grouping keeps the
   * whole pass to a handful of writes.
   *
   * Bodies are still raw and unedited inside each bundle; only the packaging
   * changed, not the contents. */
  const groupOf = (label) => (label.includes('/') ? label.split('/')[0] : 'feeds');

  const bundles = new Map();
  for (const r of results) {
    if (r.body == null) continue;
    const g = groupOf(r.label);
    if (!bundles.has(g)) bundles.set(g, {});

    /* Store the body PARSED where possible so the bundle is readable JSON
     * rather than a wall of escaped strings. Unparseable bodies are kept
     * verbatim as text — an upstream error page is itself a finding. */
    let value;
    try {
      value = JSON.parse(r.body);
    } catch {
      value = { __unparsed_text: r.body.slice(0, 20000) };
    }
    bundles.get(g)[r.label] = value;
  }

  for (const [group, obj] of bundles) {
    try {
      written.push(
        await commitFile(
          token,
          `probes/${stamp}/${group}.json`,
          JSON.stringify(obj, null, 2),
          `probe: ${group} @ ${stamp}`
        )
      );
    } catch (e) {
      writeErrors.push(`${group}: ${String(e.message || e)}`);
    }
  }

  /* The index: every probe's status, timing, and CORS header, bodies stripped.
   * This is the file to read first. */
  const index = {
    probedAt: new Date().toISOString(),
    note: 'Temporary build scaffolding (SPEC §15). Delete probes/ and functions/api/probe.js after Phase 4.',
    /* What stage 2 was built from — makes the results interpretable without
     * re-deriving the slot math by hand. */
    derived,
    complete: skipped.length === 0,
    skipped,
    results: results.map(({ body, ...rest }) => rest),
    writeErrors,
  };

  try {
    written.push(
      await commitFile(
        token,
        `probes/${stamp}/index.json`,
        JSON.stringify(index, null, 2),
        `probe: index @ ${stamp}`
      )
    );
  } catch (e) {
    writeErrors.push(`index: ${String(e.message || e)}`);
  }

  /* Report honestly: if GitHub writes failed, say so loudly rather than
   * returning a cheerful 200 over a probe that saved nothing. */
  const allWritesFailed = written.length === 0;
  return json(allWritesFailed ? 502 : 200, {
    ok: !allWritesFailed,
    probedAt: index.probedAt,
    folder: `probes/${stamp}/`,
    complete: skipped.length === 0,
    skippedCount: skipped.length,
    targetCount: stage1.length + stage2.length,
    upstream: results.map((r) => ({
      label: r.label,
      ok: r.ok,
      status: r.status,
      elapsedMs: r.elapsedMs,
      bodyBytes: r.bodyBytes ?? 0,
      error: r.error,
      note: r.note,
    })),
    written,
    writeErrors,
  });
}
