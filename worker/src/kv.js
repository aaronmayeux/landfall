/**
 * kv.js — the WRITE side of SPEC §17 Pass B. The only writer in the system.
 *
 * Pages Functions read this namespace and never write it
 * (`functions/api/_kv-cache.js` explains why at length: 300 colos writing the
 * same key is the write storm the whole pass exists to delete, with a bill
 * attached). Everything that puts bytes into KV goes through this file.
 *
 * WRITE-IF-CHANGED IS NOT AN OPTIMISATION, IT IS THE BUDGET.
 * KV's free tier allows 1,000 writes/day and the paid plan 1M/month. A blind
 * 5-minute cron over the list feeds alone is 864 writes/day before a single
 * storm exists; add per-storm advisories, decks, warnings and geometry across
 * ten active systems and it is ~18,000/day. But almost none of that payload
 * actually CHANGES: advisories issue every 6 hours, synoptic model cycles are
 * 6-hourly, and a quiet ocean publishes the same bytes for months. Hashing
 * before writing turns "how many keys are there" into "how much weather
 * happened", which is the number that should drive the bill. **The key COUNT is
 * bounded by `KEY_TTL_SECONDS` below; without it that count only grows and the
 * budget arithmetic here is written against a number that keeps moving.**
 *
 * THE HASH LIVES IN KV METADATA, AND `list()` IS WHY.
 * KV has no read-the-metadata-without-the-value call — but `list()` returns
 * every key's metadata without any of their values. So one list call per cycle
 * yields every previous hash for the price of one operation, with no 400 kB
 * geometry blob read back just to be compared and thrown away. The obvious
 * alternative — one key holding a map of all the hashes — is a god-object with
 * a read-modify-write race in it, and this needs neither.
 *
 * Runs in a standalone Worker (`worker/`), a SEPARATE DEPLOY from the Pages
 * project, so nothing here can import from the app or from functions/ (§3).
 */

/** Mirrors `KV_PREFIX` in functions/api/_kv-cache.js. Both sides namespace
 *  their keys identically or the writer and the reader never meet;
 *  tools/test-kv-keys.mjs asserts they agree. */
export const KV_PREFIX = 'v1';

export const kvKey = (path) => `${KV_PREFIX}:${path}`;

/**
 * How long a key survives without being rewritten. 48 hours, in seconds.
 *
 * ==> WITHOUT THIS THE NAMESPACE ONLY EVER GROWS. <== Measured live on
 * 2026-08-07: 184 keys, the oldest 12.3 days stale, belonging to storms that
 * ended weeks earlier. GDACS numbers its geometry per ADVISORY — `episodeid=31`
 * on a single event — so one storm that runs thirty-one advisories leaves
 * thirty-one keys behind, permanently, and the comment below this one had been
 * costing its budget against "twelve steady-state keys".
 *
 * ==> IT COSTS THE LIVE DATA NOTHING, AND THAT IS THE WHOLE ARGUMENT. <== Every
 * key still being derived is rewritten on every cycle, which resets its clock,
 * so an active storm's entries never approach this. Only keys nothing derives
 * any more — dead storms — age out. Zero delete calls, no cleanup job to write
 * or to forget about.
 *
 * WHY 48 AND NOT 9. Nine hours is the longest window any route will still USE a
 * KV copy for (`STALE_SECONDS`), so anything past that is already declined and
 * costs nothing to keep. The only thing a longer number buys is surviving a
 * dead cron without the namespace emptying underneath the app, and 48 hours is
 * five times the longest useful window while still clearing a finished storm
 * within two days. Shorter risks a weekend outage draining the store; much
 * longer just re-grows the pile more slowly.
 *
 * A DRAINED NAMESPACE IS NOT AN OUTAGE. If the cron does stay dead past this,
 * every route degrades to exactly its pre-Pass-B behaviour and fetches upstream
 * — that is L3's entire job (`functions/api/_kv-cache.js`).
 */
export const KEY_TTL_SECONDS = 48 * 60 * 60;

/** SHA-256 of a string, hex. Web Crypto is in the Workers runtime already. */
export async function hash(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Every key currently in the namespace → its stored hash.
 *
 * Paginated, because `list()` caps at 1000 keys per call and a busy season
 * with per-storm products across two hemispheres can approach that. An
 * unpaginated list would silently see only the first page, report every key
 * past it as "changed", and rewrite the whole tail of the namespace every
 * cycle — a quiet doubling of the bill that looks exactly like working code.
 */
export async function loadHashes(kv) {
  const hashes = new Map();
  let cursor;
  for (;;) {
    const page = await kv.list({ prefix: `${KV_PREFIX}:`, cursor });
    for (const k of page.keys) {
      if (k.metadata && k.metadata.hash) hashes.set(k.name, String(k.metadata.hash));
    }
    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  }
  return hashes;
}

/**
 * Write one entry and ALWAYS re-stamp it.
 *
 * ===> `fetchedAt` MEANS "WHEN DID WE LAST REACH UPSTREAM", NOT "WHEN DID THIS
 *      CHANGE". IT IS REFRESHED EVERY CYCLE, CHANGED BYTES OR NOT. <===
 * That is the contract the rest of the system already assumed and the one
 * `config/constants.js` documents for `X-Landfall-Fetched-At`: stamped at OUR
 * fetch, not at NHC's issuance, so a quiet ocean with no new advisories still
 * gets re-stamped on every cycle. Two things read it and both ask the same
 * question — `kvRead` to decide whether the warm copy is current, and the
 * client's status strip to decide whether to say the feed is delayed.
 *
 * ===> WHAT REFRESHING IT ONLY ON A CHANGE ACTUALLY COST. <===
 * A 6-hourly advisory against a 5-minute window was judged stale ~98% of the
 * time, so every route declined the warm copy and every colo went to the
 * origin twice an hour — the exact load Pass B exists to delete. A quiet ocean
 * was worse: `{"activeStorms":[]}` never changes at all, so the stamp froze and
 * the store was bypassed 100% of the time, indefinitely. And when the freshness
 * bug was fixed without fixing the stamp, that frozen value reached the client,
 * which read weeks of no-change as ~72 consecutive failed refreshes and put a
 * "feed delayed" banner over a perfectly healthy relay. Crying wolf is not the
 * safe direction to fail: a strip that shouts at nothing is a strip people
 * learn to ignore, and that costs the one outage it exists for.
 *
 * ===> §5 IS STILL ENFORCED. IT IS THE FETCH FAILING, NOT THE BYTES SITTING
 *      STILL. <=== The rule is that a source which has stopped updating must
 * not read as a source that is fine, and it still cannot: if the cron cannot
 * reach a route, `store()` never calls this, nothing re-stamps, the entry ages
 * out of every window and the routes go upstream themselves. A CALM OCEAN IS
 * NOT AN OUTAGE, and a stamp that only moved on change could not tell those
 * two apart — which is what made it the wrong ruler.
 *
 * ===> THERE IS DELIBERATELY NO SECOND "WHEN DID THE CONTENT CHANGE" STAMP. <===
 * One was built and removed the same day: nothing reads it. Storm age comes
 * from the storm's own `lastUpdate` field, not from this namespace, and the
 * `written` count below already records that a change happened — with a
 * timestamp, in the Workers Logs, kept seven days. A field nobody reads is the
 * `X-Landfall-Empty` mistake with a bill attached.
 *
 * WRITE-IF-CHANGED NOW DECIDES WHAT THE WRITE MEANS, NOT WHETHER ONE HAPPENS.
 * The hash still separates a real content change from a routine re-stamp, so
 * the cycle summary still answers "how much weather happened" even though every
 * key is put. Writes track key-count × cadence: ~3,500/day at twelve
 * steady-state keys on a five-minute cron, against the paid plan's 1M/month.
 *
 * @returns {'written'|'restamped'|'skipped'}
 */
export async function writeIfChanged(kv, path, body, previousHashes) {
  /* An empty body is never stored. Every source here has a real payload; an
   * empty one means something answered 200 with nothing, and caching that
   * globally for everyone is worse than one colo missing. */
  if (typeof body !== 'string' || body.length === 0) return 'skipped';

  const key = kvKey(path);
  const digest = await hash(body);
  const unchanged = previousHashes.get(key) === digest;

  await kv.put(key, body, {
    expirationTtl: KEY_TTL_SECONDS,
    metadata: { fetchedAt: new Date().toISOString(), hash: digest },
  });

  previousHashes.set(key, digest);
  return unchanged ? 'restamped' : 'written';
}
