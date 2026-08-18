/**
 * _telemetry-store.js — the D1 sink for /api/beacon. SPEC §17 A5.
 *
 * The leading underscore is load-bearing: Cloudflare Pages does not route
 * files whose name starts with `_`, so this is a module beacon.js imports and
 * never an endpoint of its own.
 *
 * ==> WHY THIS IS NOT IN beacon.js <==
 * beacon.js owns one job: deciding what is allowed to be recorded. This file
 * owns a different one: where it goes. Mixing them means the next sink change
 * edits the file that enforces the privacy allowlist, which is the file that
 * should change least. They are separated so a storage decision can never
 * quietly become a policy decision.
 *
 * ==> WHY D1 AND NOT ANALYTICS ENGINE <==
 * Analytics Engine was the original design and it did not survive contact:
 * it needs an ACCOUNT ENTITLEMENT that is not self-serve, and a binding to an
 * unentitled product FAILS THE ENTIRE FUNCTION DEPLOY. See beacon.js and
 * SPEC §17. D1 has no entitlement, is on the free plan, and — the reason it
 * was chosen over simply staying on the console — it can be QUERIED. The
 * console sink loses history the moment the log scrolls; that was always the
 * real cost of the fallback, and this is what buys it back.
 *
 * ==> THE THREE TABLES, AND WHY THEY ARE SHAPED DIFFERENTLY <==
 * `sessions` — one wide row per visit, written once when the visit ends. Load
 *   timings, device and connection context, and plain counts of what was
 *   used. Wide-and-rare is the right shape here: the client accumulates all
 *   of it in memory (lib/perf.js, lib/usage.js) and hands over a single
 *   snapshot, so a visitor who taps two hundred times is one row with bigger
 *   numbers rather than two hundred rows.
 *
 * `events` — one row per error or rejection. These are rare, per-session, and
 *   the detail IS the value. Storing them whole costs almost nothing.
 *
 * `source_rollup` — a COUNTER, not a log. Source transitions are the flood
 *   case: when NHC flips to `unavailable`, every live session reports it
 *   within one visibilitychange. Five thousand readers is five thousand
 *   beacons describing ONE FACT. Writing five thousand rows would make the
 *   table unreadable for exactly the event it exists to surface. Instead each
 *   beacon increments a per-minute counter, so an outage is a handful of rows
 *   with a big `n` — which is also the more useful answer, because "how many
 *   sessions saw it" is the question.
 *
 *   HONEST LIMIT: this bounds STORAGE and QUERY COST, not D1's write quota.
 *   An upsert still counts as a row written, so five thousand beacons is
 *   still five thousand writes against the 100k/day free ceiling. The lever
 *   for write VOLUME remains TELEMETRY.sampleRate in config/constants.js.
 *
 * ==> IT CANNOT BREAK THE APP, AND IT CANNOT DELAY A RESPONSE <==
 * Same contract as lib/telemetry.js: diagnostics that can degrade the product
 * are worse than no diagnostics. Every export swallows its own failures. The
 * caller runs this inside `context.waitUntil()` so the 204 goes out first and
 * the write happens after — a slow database can never become a slow beacon.
 *
 * Imports: nothing. Imported by functions/api/beacon.js only.
 */

/** Rollup granularity. One minute is fine enough to see an outage start and
 *  coarse enough that a crowd collapses into a single row. Changing this
 *  changes the meaning of every existing `bucket` value — do not. */
const BUCKET_SECONDS = 60;

/** `reason` is part of the rollup's primary key, so its cardinality is the
 *  thing that decides whether the rollup actually rolls up. The store emits
 *  short machine codes (see lib/telemetry.js), but this file must not depend
 *  on that staying true — an unexpectedly chatty reason would silently turn
 *  the counter back into a log. Clipped hard, here, on purpose. */
const MAX_ROLLUP_REASON = 64;

/**
 * Every column of `sessions`, in the order the INSERT binds them.
 *
 * ==> ONE LIST, AND THE SQL IS BUILT FROM IT. <==
 * Thirty-nine columns hand-written three times — once in the column list,
 * once as placeholders, once as bound values — is a transposition bug waiting
 * to happen, and the failure mode is silent: the row still writes, with the
 * screen width in the core count. Deriving all three from this array makes
 * that class of bug impossible rather than merely unlikely.
 *
 * APPEND ONLY. Reordering re-points every future write at different columns.
 */
const SESSION_COLUMNS = Object.freeze([
  'ts', 'app', 'country', 'standalone',
  'platform', 'engine', 'nav_type', 'transfer_bytes', 'sw_controlled',
  'ttfb_ms', 'fcp_ms', 'lcp_ms', 'dcl_ms', 'load_ms',
  't_globe_ms', 't_data_ms', 't_storms_ms',
  'longtask_n', 'longtask_ms', 'worst_event_ms', 'webgl_lost',
  'conn_type', 'conn_rtt', 'conn_down', 'save_data',
  'screen_w', 'screen_h', 'dpr', 'mem_gb', 'cores',
  'storm_select', 'advisory_open', 'layer_toggle', 'layer_pair', 'layer_reset',
  'model_toggle', 'recenter', 'home_set', 'retry',
  /* Appended 2026-07-31. Order matches `ALTER TABLE ... ADD COLUMN`, which
   * also appends — see claude/telemetry-d1-sink note. */
  'hidden_at_start', 'first_hidden_ms',
  /* Appended 2026-08-05.
   *
   * `device` — the anonymous device number, the first cross-visit identifier
   *   this table has ever held. It is what makes "how many people" and "how
   *   many came back" answerable at all; before it, every row was an island.
   *   Read lib/device-id.js before using or extending it. It arrives from the
   *   beacon ENVELOPE and only ever lands on this table, never on `events`
   *   and never on `source_rollup` — a counter describing a crowd has no
   *   business carrying an identifier.
   *
   * `timings_ok` — 0 unknown / 1 clean / 2 backgrounded. Derived in
   *   beacon.js, not sent by the client. ==> READ IT BEFORE AVERAGING ANY
   *   MILLISECOND COLUMN IN THIS TABLE. <== A row is only a measurement when
   *   this is 1; the other two values are visits whose clocks cannot be
   *   trusted, and they still count as visits. */
  'device', 'timings_ok',
  /* Appended 2026-08-14. All five exist to answer questions the table could
   * be asked but not made to answer, discovered while reading a traffic
   * spike that tripled the day's visits.
   *
   * `t_scripts_ms` — the vendored MapLibre + Three have finished running.
   *   Splits the largest stage of the load — first paint to touchable globe —
   *   into "the browser digesting 1.5 MB of library" and "us building the
   *   map". One number spanning both could not choose between two unrelated
   *   fixes.
   *
   * `boot_longtask_n` / `boot_longtask_ms` — blocked main thread DURING BOOT
   *   ONLY. The existing `longtask_*` pair covers the whole visit and sits
   *   right beside the load timings, which invites a comparison that is
   *   nonsense; doing it produced rows apparently claiming 74 seconds of
   *   freeze inside an 11-second load. See lib/perf.js.
   *
   * `visit_ms` — how long the visit lasted. The denominator the blocked-time
   *   columns never had, and without which they can only be compared against
   *   boot timings, i.e. wrongly.
   *
   * `ref_host` — the referring SITE NAME, hostname only, empty for direct and
   *   same-origin visits. Shape-checked in beacon.js and truncated on the
   *   device before it is ever sent. It is a property of the link, identical
   *   for everyone who arrived the same way, and is NOT a location field —
   *   the contract in lib/telemetry.js still forbids region, city and colo. */
  't_scripts_ms', 'boot_longtask_n', 'boot_longtask_ms', 'visit_ms', 'ref_host',
  /* Appended 2026-08-18.
   *
   * `retry_which` — WHICH Retry buttons were pressed, beside `retry`, which
   *   only ever said how many presses there were. There are four such buttons
   *   and they mean four completely different failures; a bare count could
   *   not tell them apart, and the thing worth knowing is which part of the
   *   app broke badly enough that somebody fought back.
   *
   *   ==> ONE FIELD, NOT ONE COLUMN PER BUTTON. <== The obvious shape is a
   *   counter each. That is a schema change every time a Retry is added, on a
   *   table that already carries forty-odd columns. This is a small text
   *   value holding the NAMES pressed, in a fixed order, drawn from a fixed
   *   list of four in both lib/usage.js and beacon.js. Adding a fifth button
   *   costs one word in two allowlists and no ALTER TABLE at all. */
  'retry_which',
]);

const SESSION_SQL =
  `INSERT INTO sessions (${SESSION_COLUMNS.join(', ')}) ` +
  `VALUES (${SESSION_COLUMNS.map(() => '?').join(', ')})`;

/**
 * Write a batch of already-validated rows.
 *
 * ==> THE ROWS ARE TRUSTED; THE CALLER IS WHY. <==
 * Everything here goes into bound parameters, never string-interpolated SQL,
 * so this is not the injection boundary. But it is also not the allowlist
 * boundary: beacon.js rebuilt every one of these objects field by field from
 * fixed keys before calling us. Do NOT add a field here that beacon.js does
 * not explicitly construct — that is how an unreviewed value reaches storage.
 *
 * @param {D1Database} db    The bound database.
 * @param {Array<object>} rows  Rows as built by beacon.js.
 * @param {number} nowSeconds Server time. Passed in rather than read here so
 *        every row in one beacon shares a timestamp and lands in one bucket.
 * @returns {Promise<void>} Always resolves. Never rejects.
 */
export async function writeTelemetry(db, rows, nowSeconds) {
  try {
    if (!db || !Array.isArray(rows) || rows.length === 0) return;

    const bucket = Math.floor(nowSeconds / BUCKET_SECONDS) * BUCKET_SECONDS;

    const insertEvent = db.prepare(
      `INSERT INTO events (ts, kind, app, country, standalone, message, stack)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    /* SQLite upsert. The conflict target must list the primary key columns in
     * the same order the table declares them. */
    const bumpSource = db.prepare(
      `INSERT INTO source_rollup
         (bucket, source, status, app, country, standalone, reason, n)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (bucket, source, status, app, country, standalone, reason)
       DO UPDATE SET n = n + 1`
    );

    const insertSession = db.prepare(SESSION_SQL);

    const statements = [];

    for (const row of rows) {
      if (row.kind === 'session') {
        /* `ts` is the SERVER's clock, injected here rather than trusted from
         * the client — a device with a wrong system time would otherwise sort
         * itself into the middle of last week. Everything else was rebuilt
         * field by field by beacon.js, so a missing key means a browser that
         * did not support that metric, and 0 is the honest value for it. */
        statements.push(
          insertSession.bind(
            ...SESSION_COLUMNS.map((c) => (c === 'ts' ? nowSeconds : row[c] ?? 0))
          )
        );
      } else if (row.kind === 'source') {
        statements.push(
          bumpSource.bind(
            bucket,
            row.source,
            row.status,
            row.app,
            row.country,
            row.standalone,
            row.reason.slice(0, MAX_ROLLUP_REASON)
          )
        );
      } else {
        statements.push(
          insertEvent.bind(
            nowSeconds,
            row.kind,
            row.app,
            row.country,
            row.standalone,
            row.message,
            row.stack
          )
        );
      }
    }

    if (!statements.length) return;

    /* One batch, one round trip. `batch` is also a transaction, so a beacon
     * either lands whole or not at all — a half-recorded beacon would be a
     * lie about what the client saw. */
    await db.batch(statements);
  } catch {
    /* ==> SWALLOWED, AND THAT IS THE POINT. <==
     * A failed telemetry write is not worth a log line of its own (it would
     * be the same line thousands of times during an incident) and definitely
     * not worth an unhandled rejection inside waitUntil. The beacon already
     * returned 204. Nothing downstream is waiting on this. */
  }
}
