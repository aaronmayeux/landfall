/**
 * telemetry-queries.mjs — the SQL the hourly D1 pull runs, and nothing else.
 *
 * WHY THIS IS ITS OWN FILE
 * It used to live inside tools/cloudflare-telemetry.mjs, which cannot be
 * imported: that file runs on load, talks to the network, and calls
 * process.exit. So the queries could not be tested at all, and the only way to
 * find out a guard had been dropped was to read a wrong number off the archive
 * and believe it. This module has no side effects and no imports — importing it
 * costs nothing and runs nothing, which is what makes tools/test-telemetry-
 * queries.mjs possible.
 *
 * THE RULES EVERY QUERY HERE FOLLOWS. Each exists because breaking it once
 * produced a plausible-looking wrong answer, which is worse than an error:
 *
 *   1. `ts` IS IN SECONDS. Always `DATE(ts, 'unixepoch')`, never a divide by
 *      1000. The first version of the daily query divided and returned one row
 *      reading "1970-01-21: 335 sessions". It did not fail. It looked fine.
 *
 *   2. `timings_ok = 1` WHEREVER A MILLISECOND COLUMN IS AVERAGED, and nowhere
 *      else. A row with untrustworthy timings is still a real visit, so
 *      filtering it out of a VISIT count silently undercounts traffic.
 *
 *   3. AN EMPTY IDENTIFIER IS NOT AN IDENTIFIER. `device` and `ref_host` both
 *      default to '' and both were added to a table that already had months of
 *      rows. Counting '' as a person invents one person shared by everybody;
 *      see COLUMN BIRTHDAYS below.
 *
 * ==> COLUMN BIRTHDAYS — READ BEFORE QUOTING ANY NUMBER FROM THESE. <==
 * The identity columns are younger than the table, so every row older than the
 * column carries the default rather than a missing value, and a plain GROUP BY
 * reports that default as though it were an answer.
 *
 *   `device`   added 2026-08-05. Sessions before that date have device = ''.
 *              They are real visits by unknown people, NOT visits by one
 *              person. Every people-count here excludes '' and every query
 *              that does so also returns how many rows it excluded, so the
 *              hole is visible in the output instead of being inferred.
 *
 *   `ref_host` added 2026-08-14. Sessions before that date have ref_host = ''.
 *              '' ALSO legitimately means direct or same-site, so the two are
 *              genuinely indistinguishable in the data — this is the one case
 *              here that cannot be fixed by SQL. It is labelled
 *              "(direct, same-site, or pre-2026-08-14)" for exactly that
 *              reason. Do not shorten that label to "(direct)": it would turn
 *              nine days of unknown provenance into a confident claim that
 *              nobody was referred, which is the failure SPEC §5 exists to
 *              prevent.
 */

/** The referrer bucket for a session with no referring site. Spelled out
 *  rather than "(direct)" — see COLUMN BIRTHDAYS above. One constant so the
 *  three queries that need it cannot drift apart. */
export const NO_REFERRER_LABEL = '(direct, same-site, or pre-2026-08-14)';

/** SQL fragment: the referrer bucket, empty mapped to the honest label. */
const SOURCE_EXPR =
  `CASE WHEN ref_host = '' THEN '${NO_REFERRER_LABEL}' ELSE ref_host END`;

/** SQL fragment: distinct people, ignoring rows that predate the `device`
 *  column. Rule 3. Removing the `<> ''` guard makes every pre-2026-08-05 day
 *  report exactly one person. */
const PEOPLE_EXPR = "COUNT(DISTINCT CASE WHEN device <> '' THEN device END)";

/** SQL fragment: how many rows the people count had to ignore. The hole,
 *  stated. */
const NO_DEVICE_EXPR = "SUM(CASE WHEN device = '' THEN 1 ELSE 0 END)";

export const QUERIES = [
  {
    name: 'schema',
    note:
      'Every table and its CREATE statement. Read this first — it is the ' +
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
    /* Added 2026-08-20. `recent-sessions` beside it answers "how many visits";
       this answers "how many PEOPLE", which is the question actually asked of
       a traffic spike and which nothing in the archive could answer before
       today. Kept as a second query rather than more columns on the first:
       that one is quoted in the spec by its exact shape, and this one carries
       a caveat about its own history that does not apply to a visit count. */
    name: 'daily-devices',
    note:
      'Visits AND people per day, last 21 days. `people` counts distinct ' +
      'devices; `sessions_without_device` is how many rows that count had to ' +
      'ignore because they predate the `device` column (added 2026-08-05). ' +
      'On any day where that number is not 0, `people` is a floor, not a ' +
      'total. 21 days, not 14, so the window always reaches back past the ' +
      "column's birthday and the ramp is visible rather than looking like a " +
      'real change in traffic.',
    sql:
      "SELECT DATE(ts, 'unixepoch') AS day, " +
      'COUNT(*) AS sessions, ' +
      `${PEOPLE_EXPR} AS people, ` +
      `${NO_DEVICE_EXPR} AS sessions_without_device ` +
      'FROM sessions GROUP BY day ORDER BY day DESC LIMIT 21',
  },
  {
    /* Added 2026-09-01. `daily-devices` says how many people; this says WHICH
       ONES KEEP COMING BACK, which is what makes "how many users other than
       me" answerable at all. Every previous query aggregated the device column
       away, so the five machines in Aaron's own house were indistinguishable
       from five strangers and could not be subtracted from any total. */
    name: 'device-roster',
    note:
      'THE REGULARS. One row per device seen on 5 OR MORE SEPARATE DAYS, with ' +
      'enough hardware description to recognise a machine you own. Screen ' +
      'size, memory and core count are already in the table; they are ' +
      'reported here only for this small set. ' +
      '==> THE 5-DAY FLOOR IS A PRIVACY DECISION, NOT A TIDINESS ONE. <== ' +
      'The archive branch is PUBLIC. A roster of every device would publish a ' +
      'fragment of the identifier plus a hardware profile for several hundred ' +
      'strangers, which is a real step down from what this branch has ever ' +
      'carried. Devices that turn up on five different days are the ones the ' +
      'question is actually about. Do not lower this floor to sweep in ' +
      'more rows. ' +
      '`device_prefix` is the FIRST 8 CHARACTERS ONLY — never the whole id. ' +
      'It exists so two rows can be told apart and named in conversation, not ' +
      'so anyone can be followed. ' +
      'The descriptive columns use MAX() because a device that rotated its ' +
      'phone or changed browser has more than one value; MAX is arbitrary but ' +
      'DETERMINISTIC, which a bare column would not be.',
    sql:
      'SELECT SUBSTR(device, 1, 8) AS device_prefix, ' +
      'MAX(platform) AS platform, MAX(engine) AS engine, ' +
      'MAX(screen_w) AS screen_w, MAX(screen_h) AS screen_h, ' +
      'MAX(dpr) AS dpr, MAX(mem_gb) AS mem_gb, MAX(cores) AS cores, ' +
      'MAX(standalone) AS ever_installed, ' +
      'COUNT(*) AS sessions, ' +
      "COUNT(DISTINCT DATE(ts, 'unixepoch')) AS days_active, " +
      "DATE(MIN(ts), 'unixepoch') AS first_seen, " +
      "DATE(MAX(ts), 'unixepoch') AS last_seen " +
      "FROM sessions WHERE device <> '' " +
      'GROUP BY device ' +
      "HAVING COUNT(DISTINCT DATE(ts, 'unixepoch')) >= 5 " +
      'ORDER BY days_active DESC, sessions DESC',
  },
  {
    /* Added 2026-08-20, the day a link went up on a forum and the archive
       could say traffic had doubled but not say why. */
    name: 'referrers',
    note:
      'WHERE VISITORS COME FROM, all time, by referring site. `ref_host` was ' +
      'added 2026-08-14, so every session before then buckets as ' +
      `"${NO_REFERRER_LABEL}" — that bucket is NOT ` +
      'proof of direct traffic and must never be reported as such. ' +
      '`first_seen`/`last_seen` are the honest way to tell a live source from ' +
      'one that sent a burst once: a host whose two dates are the same day ' +
      'was a single posting, not a channel.',
    sql:
      `SELECT ${SOURCE_EXPR} AS source, ` +
      'COUNT(*) AS sessions, ' +
      `${PEOPLE_EXPR} AS people, ` +
      "DATE(MIN(ts), 'unixepoch') AS first_seen, " +
      "DATE(MAX(ts), 'unixepoch') AS last_seen " +
      'FROM sessions GROUP BY source ORDER BY sessions DESC LIMIT 50',
  },
  {
    /* Added 2026-08-20. The all-time table above cannot show a spike: one busy
       day and a steady trickle add up to the same row. This one keeps the days
       apart, which is the whole point of asking. */
    name: 'referrers-daily',
    note:
      'Referring site per day for the last 7 days — the shape of a spike, ' +
      'which the all-time table flattens away. Bounded by a WHERE on `ts` ' +
      'rather than a LIMIT: a LIMIT on a two-column grouping silently drops ' +
      "the quietest sources on the busiest day, and those are exactly the " +
      'new arrivals worth seeing.',
    sql:
      "SELECT DATE(ts, 'unixepoch') AS day, " +
      `${SOURCE_EXPR} AS source, ` +
      'COUNT(*) AS sessions, ' +
      `${PEOPLE_EXPR} AS people ` +
      'FROM sessions ' +
      "WHERE ts >= STRFTIME('%s', 'now') - (7 * 86400) " +
      'GROUP BY day, source ORDER BY day DESC, sessions DESC',
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
