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
 * happened", which is the number that should drive the bill.
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

/** SHA-256 of a string, hex. Web Crypto is in the Workers runtime already. */
export async function hash(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Every key currently in the namespace → what its metadata says about it:
 * `{ hash, fetchedAt }`.
 *
 * ===> ONE `list()` CALL YIELDS BOTH, WHICH IS WHY THE TWO-STAMP SCHEME IS FREE. <===
 * KV has no read-the-metadata-without-the-value call, but `list()` returns
 * every key's metadata without any of their values. The hash is what decides
 * changed-versus-unchanged; `fetchedAt` is what a re-stamp must CARRY FORWARD
 * rather than overwrite, and having it here means preserving it costs no extra
 * operation. Reading each value back to recover its old stamp would cost a
 * read per key to save nothing.
 *
 * Paginated, because `list()` caps at 1000 keys per call and a busy season
 * with per-storm products across two hemispheres can approach that. An
 * unpaginated list would silently see only the first page, report every key
 * past it as "changed", and rewrite the whole tail of the namespace every
 * cycle — a quiet doubling of the bill that looks exactly like working code.
 */
export async function loadPrevious(kv) {
  const previous = new Map();
  let cursor;
  for (;;) {
    const page = await kv.list({ prefix: `${KV_PREFIX}:`, cursor });
    for (const k of page.keys) {
      if (!k.metadata || !k.metadata.hash) continue;
      previous.set(k.name, {
        hash: String(k.metadata.hash),
        fetchedAt: k.metadata.fetchedAt ? String(k.metadata.fetchedAt) : null,
      });
    }
    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  }
  return previous;
}

/**
 * Write one entry, always stamping WHEN WE CHECKED and stamping WHEN IT
 * CHANGED only when it actually did.
 *
 * ===> TWO STAMPS, BECAUSE ONE WAS ANSWERING TWO DIFFERENT QUESTIONS. <===
 * This file used to keep a single `fetchedAt`, refreshed only on a real
 * content change, and `kvRead` judged freshness against it. Those are not the
 * same question and one field cannot hold both answers:
 *
 *   verifiedAt   WHEN DID WE LAST CHECK. Refreshed every successful cycle,
 *                changed bytes or not. This is what freshness is judged on,
 *                because "is our picture current" is a question about the
 *                LOOP, not about the weather.
 *
 *   fetchedAt    WHEN DID THE CONTENT LAST CHANGE. Refreshed only on a real
 *                write. This is what the reader sees in
 *                `X-Landfall-Fetched-At`, because a person asking how old the
 *                data is means the DATA, not our polling.
 *
 * The old single-field behaviour punished slow feeds for being slow. An
 * advisory re-issues every six hours against a five-minute window, so for
 * about 98% of its life the warm copy was judged too old, every route declined
 * it, and every colo went to the origin twice an hour — which is the exact
 * load this whole pass exists to delete. A quiet ocean was worse still:
 * `{"activeStorms":[]}` never changes at all, so the stamp froze and the
 * shared store was bypassed 100% of the time, indefinitely.
 *
 * ===> §5 IS STILL ENFORCED, JUST BY THE RIGHT FIELD. <===
 * The rule this protects is that a source which has stopped updating must not
 * read as a source that is fine. That is still true and still structural: if
 * the cron cannot reach a route, `store()` never calls this function, nothing
 * re-stamps, `verifiedAt` ages out of every route's window, and the routes go
 * to upstream themselves. What changed is WHAT counts as a source going dark
 * — it is the fetch failing, not the bytes sitting still. A calm ocean is not
 * an outage, and the old field could not tell those apart.
 *
 * ===> AND THE WRITE BUDGET IS NOW A DIFFERENT, LARGER NUMBER. <===
 * Write-if-changed made writes track "how much weather happened". Re-stamping
 * makes them track "how many keys × how often the cron runs" — about 3,500 a
 * day at twelve steady-state keys on a five-minute cron, and roughly 9,000 in
 * a busy season. That is comfortably inside the paid plan's 1M/month and
 * comfortably OUTSIDE the free tier's 1,000/day. It is the price of the
 * shared store actually being read instead of paid for and bypassed.
 *
 * The `written` / `restamped` split below is what keeps the old signal alive:
 * `written` still counts real content changes, so the cycle summary still
 * answers "how much weather happened" even though every key was put.
 *
 * @returns {'written'|'restamped'|'skipped'}
 */
export async function writeIfChanged(kv, path, body, previous) {
  /* An empty body is never stored. Every source here has a real payload; an
   * empty one means something answered 200 with nothing, and caching that
   * globally for everyone is worse than one colo missing. */
  if (typeof body !== 'string' || body.length === 0) return 'skipped';

  const key = kvKey(path);
  const digest = await hash(body);
  const now = new Date().toISOString();
  const before = previous.get(key) || null;
  const unchanged = !!before && before.hash === digest;

  /* KV HAS NO METADATA-ONLY UPDATE — a stamp change costs a full put, value
   * and all. That is why this is one code path rather than two: the body is
   * already in hand from the fetch that just succeeded, so a re-stamp costs a
   * write and nothing else. Reading the old value back to avoid rewriting it
   * would cost a read AND a write to save neither. */
  await kv.put(key, body, {
    metadata: {
      verifiedAt: now,
      /* PRESERVED, NOT REFRESHED, when the bytes did not move. The old stamp
       * comes off the same `list()` call that yields the hashes, so carrying it
       * costs nothing. A missing one falls back to now — correct for a key
       * written for the first time, which is the only case where the two stamps
       * are equal by construction. */
      fetchedAt: (unchanged && before.fetchedAt) || now,
      hash: digest,
    },
  });

  /* Keep the in-memory map in step, so a second call for the same key inside
   * one cycle sees this write rather than the pre-cycle state. Nothing does
   * that today — `derived` is deduplicated before it is warmed — but a map
   * that silently disagrees with the store is how the dedup quietly becoming
   * optional turns into a re-stamp that clobbers a fresh `fetchedAt`. */
  previous.set(key, { hash: digest, fetchedAt: (unchanged && before.fetchedAt) || now });
  return unchanged ? 'restamped' : 'written';
}
