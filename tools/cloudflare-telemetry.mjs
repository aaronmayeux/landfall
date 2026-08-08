#!/usr/bin/env node
/**
 * cloudflare-telemetry.mjs — pull the D1 telemetry into files a phone can read.
 *
 * WHY THIS EXISTS
 * The Cloudflare MCP is the other way to reach this data, and on 2026-08-08 it
 * was simply absent from a session with nobody noticing until someone went
 * looking. A connector that can silently not be there is a bad single route to
 * the numbers that tell us whether the app is healthy. A GitHub Actions runner
 * has open internet and a secret store, so it can ask Cloudflare directly and
 * commit the answers next to the weather payloads. No connector, no device,
 * nothing to be missing.
 *
 * WHAT IT NEEDS
 *   CLOUDFLARE_API_TOKEN    required. Permission: Account -> D1 -> Read.
 *                           Read is genuinely enough; the query endpoint accepts
 *                           D1 Read or D1 Write, and this only ever SELECTs.
 *   CLOUDFLARE_ACCOUNT_ID   optional. Discovered automatically if the token can
 *                           list accounts; set it if that ever stops working.
 *
 * FAILURE IS RECORDED, NEVER SWALLOWED (SPEC §5)
 * A missing token, a dead API, or a query whose SQL no longer matches the
 * schema each land in the manifest as `unavailable` with the reason. Nothing is
 * written as an empty result, because an empty result reads as "no traffic" and
 * that is the same conflation the spec exists to prevent. Exits 0 either way —
 * a Cloudflare outage is news, not a broken build.
 *
 * THE QUERIES ARE INDEPENDENT ON PURPOSE
 * One query failing because a column was renamed must not cost you the other
 * six. Each runs on its own and reports on its own.
 *
 * Zero dependencies. Run: node tools/cloudflare-telemetry.mjs <output-dir>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node tools/cloudflare-telemetry.mjs <output-dir>');
  process.exit(2);
}

/* Overridable so the loop can be exercised against a stub. There is no way to
   reach the real API from the sandbox, and an unattended hourly job whose
   error handling has never been executed is a job you are trusting on faith. */
const API = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

/* Not a secret. A D1 database id is a resource identifier, visible in the
   dashboard URL, and grants nothing without a token on the account — the same
   reasoning worker/wrangler.toml already applies to the KV namespace id. */
const DB_ID = 'dc08ce89-b597-40da-b5b5-7571a9b30d90';
const DB_NAME = 'landfall-telemetry';

const TIMEOUT_MS = 30_000;

mkdirSync(OUT, { recursive: true });

/** Write the manifest and leave. Used by every early exit so there is exactly
 *  one way this script can finish, and it always leaves a reason behind. */
function finish(state, reason, extra = {}) {
  const manifest = {
    fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    database: DB_NAME,
    databaseId: DB_ID,
    state,
    reason,
    ...extra,
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\ntelemetry: ${state}${reason ? ' — ' + reason : ''}`);
  process.exit(0);
}

if (!TOKEN) {
  finish(
    'unavailable',
    'CLOUDFLARE_API_TOKEN is not set on this repository. Add it under ' +
      'Settings > Secrets and variables > Actions. Permission needed: Account > D1 > Read.',
    { queries: [] }
  );
}

async function cf(path, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    /* THE NETWORK FAILING IS A RESULT, NOT AN EXCEPTION. An uncaught DNS error
       here used to take the whole script down with a stack trace and no
       manifest at all — the exact silent failure this file is supposed to
       prevent, in the file meant to prevent it. Caught on 2026-08-08 by
       running it in the sandbox, where api.cloudflare.com is blocked. */
    const res = await fetch(API + path, {
      ...init,
      signal: ctl.signal,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* Cloudflare returned something that is not JSON — an edge error page,
         usually. Keep the text so the reason is readable. */
    }
    return { ok: res.ok, status: res.status, body, text };
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    const cause = err && err.cause ? ` (${err.cause.code || err.cause.message})` : '';
    return { ok: false, status: 0, body: null, text: '', network: msg + cause };
  } finally {
    clearTimeout(timer);
  }
}

/** Cloudflare puts real errors in `errors[]` with a code. Surface those rather
 *  than a bare status, because "10000 Authentication error" tells you the token
 *  is wrong and "7003 Could not route" tells you the account id is. */
function cfReason(r) {
  if (r.network) return `could not reach api.cloudflare.com: ${r.network}`;
  const errs = r.body && Array.isArray(r.body.errors) ? r.body.errors : [];
  if (errs.length) return errs.map((e) => `${e.code} ${e.message}`).join('; ');
  return `HTTP ${r.status}${r.text ? ' — ' + r.text.slice(0, 200) : ''}`;
}

/* --- account id ----------------------------------------------------------- */
let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
let accountSource = accountId ? 'CLOUDFLARE_ACCOUNT_ID secret' : null;

if (!accountId) {
  const r = await cf('/accounts?per_page=50');
  if (r.ok && r.body && Array.isArray(r.body.result) && r.body.result.length) {
    accountId = r.body.result[0].id;
    accountSource = `discovered (${r.body.result.length} account(s) visible to this token)`;
  } else {
    finish(
      'unavailable',
      'could not determine the Cloudflare account id. The token may not be ' +
        'allowed to list accounts — set the CLOUDFLARE_ACCOUNT_ID secret and ' +
        `it will be used directly. Cloudflare said: ${cfReason(r)}`,
      { queries: [] }
    );
  }
}
console.log(`account ${accountId} — ${accountSource}`);

/* --- the queries ---------------------------------------------------------- *
 * Written against the schema as understood on 2026-08-08. If one of these
 * fails because a column moved, THAT IS THE POINT — the manifest names the
 * query and the error instead of the whole thing going quiet. Fix the SQL here.
 *
 * `timings_ok = 1` is always filtered where timings are involved: a session
 * that reported bad timings is noise, and including it moves the averages
 * without telling you it did.
 */
const QUERIES = [
  {
    name: 'schema',
    note: 'Every table and its CREATE statement. Read this first — it is the ' +
      'ground truth for what the other queries can ask about.',
    sql: "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  },
  {
    name: 'table-counts',
    note: 'Row count per table. A count that stops moving is the first sign the writer died.',
    sql:
      "SELECT 'events' AS table_name, COUNT(*) AS rows FROM events " +
      "UNION ALL SELECT 'sessions', COUNT(*) FROM sessions " +
      "UNION ALL SELECT 'source_rollup', COUNT(*) FROM source_rollup",
  },
  {
    name: 'platform-rollup',
    note:
      'THE WINDOWS QUESTION. Windows was averaging 2,403 ms blocked against ' +
      '0 ms on iOS as of 2026-08-08, worst case 29,604 ms. ' +
      'There is NO `blocked_ms` column — the first version of this query ' +
      'invented one and failed with SQLITE_ERROR. Blocked time is ' +
      '`longtask_ms`: main-thread long tasks, which is what a frozen globe ' +
      'actually is. `worst_event_ms` is the single worst one.',
    sql:
      'SELECT platform, COUNT(*) AS clean_sessions, ' +
      'ROUND(AVG(longtask_ms)) AS avg_blocked_ms, ' +
      'MAX(longtask_ms) AS worst_blocked_ms, ' +
      'MAX(worst_event_ms) AS worst_single_event_ms, ' +
      'ROUND(AVG(longtask_n)) AS avg_longtask_count, ' +
      'ROUND(AVG(t_globe_ms)) AS avg_veil_lift_ms, ' +
      'ROUND(AVG(t_storms_ms)) AS avg_storms_ms, ' +
      'ROUND(AVG(lcp_ms)) AS avg_lcp_ms ' +
      'FROM sessions WHERE timings_ok = 1 ' +
      'GROUP BY platform ORDER BY avg_blocked_ms DESC',
  },
  {
    name: 'recent-sessions',
    note:
      'Sessions per day for the last 14 days. ' +
      '==> `ts` IS IN SECONDS, NOT MILLISECONDS. <== The first version of ' +
      'this query divided by 1000 and returned ONE row reading ' +
      '"1970-01-21: 335 sessions". It did not error. It came back looking ' +
      'entirely plausible and was completely wrong, which is worse than ' +
      'failing. Verified against the schema: sessions.ts = 1786208965 is ' +
      '2026-08-08T17:09Z read as seconds, and 1970 read as milliseconds.',
    sql:
      "SELECT DATE(ts, 'unixepoch') AS day, COUNT(*) AS sessions " +
      'FROM sessions GROUP BY day ORDER BY day DESC LIMIT 14',
  },
  {
    name: 'source-rollup',
    note: 'Per-source health. Which feeds are answering and which are not.',
    sql: 'SELECT * FROM source_rollup ORDER BY rowid DESC LIMIT 50',
  },
  {
    name: 'recent-events',
    note: 'The last 100 events, newest first. The raw trail behind everything above.',
    sql: 'SELECT * FROM events ORDER BY rowid DESC LIMIT 100',
  },
  {
    name: 'freshness',
    note:
      'How long ago the newest session landed. If `hours_since_newest` grows ' +
      'past a few hours while the app is live, telemetry is not arriving and ' +
      'every number above is stale WITHOUT LOOKING STALE. Read this before ' +
      'trusting anything else here. Timestamps are rendered as text too, ' +
      'because a bare integer is exactly how the seconds-vs-milliseconds bug ' +
      'got past review.',
    sql:
      'SELECT MAX(ts) AS newest_ts, MIN(ts) AS oldest_ts, COUNT(*) AS total, ' +
      "DATETIME(MAX(ts), 'unixepoch') AS newest_utc, " +
      "DATETIME(MIN(ts), 'unixepoch') AS oldest_utc, " +
      "ROUND((STRFTIME('%s','now') - MAX(ts)) / 3600.0, 1) AS hours_since_newest " +
      'FROM sessions',
  },
];

const report = [];
let okCount = 0;

for (const q of QUERIES) {
  const started = Date.now();
  const r = await cf(`/accounts/${accountId}/d1/database/${DB_ID}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql: q.sql }),
  });
  const ms = Date.now() - started;

  /* The D1 query endpoint returns an ARRAY of results, one per statement. */
  const first = r.ok && r.body && Array.isArray(r.body.result) ? r.body.result[0] : null;

  if (first && first.success) {
    const rows = first.results || [];
    writeFileSync(join(OUT, `${q.name}.json`), JSON.stringify(rows, null, 2) + '\n');
    report.push({ name: q.name, status: 'ok', rows: rows.length, ms, note: q.note, sql: q.sql });
    okCount++;
    console.log(`ok   ${q.name.padEnd(18)} ${String(rows.length).padStart(5)} rows  ${ms} ms`);
  } else {
    const reason = cfReason(r);
    report.push({ name: q.name, status: 'unavailable', rows: 0, ms, note: q.note, sql: q.sql, reason });
    console.log(`FAIL ${q.name.padEnd(18)} ${ms} ms  ${reason}`);
  }
}

/* A small human-readable summary, so the interesting number is visible without
   opening a JSON file on a phone. */
const lines = ['# telemetry — generated hourly, do not edit', ''];
const platform = report.find((r) => r.name === 'platform-rollup');
if (platform && platform.status === 'ok') {
  lines.push('See `platform-rollup.json` for the per-platform blocked-time table.');
} else if (platform) {
  lines.push(`**platform-rollup is unavailable:** ${platform.reason}`);
}
lines.push('', '| query | status | rows |', '|---|---|---|');
for (const r of report) lines.push(`| \`${r.name}\` | ${r.status} | ${r.rows} |`);
lines.push('');
writeFileSync(join(OUT, 'README.md'), lines.join('\n'));

finish(
  okCount === QUERIES.length ? 'ok' : okCount ? 'partial' : 'unavailable',
  okCount === QUERIES.length ? null : `${QUERIES.length - okCount} of ${QUERIES.length} queries failed`,
  { accountId, accountSource, ok: okCount, total: QUERIES.length, queries: report }
);
