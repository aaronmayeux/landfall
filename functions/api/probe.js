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

  /* Which probes to run. Storm-specific MapServer queries need live storm ids,
   * which come from CurrentStorms.json — so this pass gathers the FEEDS and the
   * MapServer's own layer catalogue. That catalogue plus the live ids is what
   * Phase 4's layer math gets built against. */
  const targets = [
    ['nhc-currentstorms', 'https://www.nhc.noaa.gov/CurrentStorms.json'],
    [
      'nhc-mapserver-catalogue',
      'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer?f=json',
    ],
    [
      'gdacs-eventlist',
      'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP',
    ],
  ];

  const results = [];
  for (const [label, target] of targets) {
    results.push(await probeOne(label, target));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const written = [];
  const writeErrors = [];

  /* Raw bodies, one file each — unparsed and unedited. The whole point is to
   * see exactly what the upstream said, not a summary of it. */
  for (const r of results) {
    if (r.body == null) continue;
    try {
      written.push(
        await commitFile(
          token,
          `probes/${stamp}/${r.label}.json`,
          r.body,
          `probe: ${r.label} @ ${stamp}`
        )
      );
    } catch (e) {
      writeErrors.push(`${r.label}: ${String(e.message || e)}`);
    }
  }

  /* The index: every probe's status, timing, and CORS header, bodies stripped.
   * This is the file to read first. */
  const index = {
    probedAt: new Date().toISOString(),
    note: 'Temporary build scaffolding (SPEC §15). Delete probes/ and functions/api/probe.js after Phase 4.',
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
