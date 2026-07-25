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
 * Write one entry, unless its bytes are already what is stored.
 *
 * `fetchedAt` IS ALWAYS REFRESHED WHEN A WRITE HAPPENS AND NEVER OTHERWISE,
 * and that asymmetry is deliberate. The stamp means "when did we last confirm
 * this content with the source", which is what the reader's freshness check
 * needs — but an unchanged payload is not re-stamped, so a feed that has gone
 * quietly static AGES in the store rather than looking eternally current.
 *
 * That is the §5 rule enforced by the infrastructure instead of hoped for: a
 * source that stops updating must not read as a source that is fine. When the
 * stamp falls outside a route's fresh window the route stops trusting KV and
 * goes to upstream itself, which is exactly the right move when the cron's
 * picture of the world has stopped moving.
 *
 * @returns {'written'|'unchanged'|'skipped'}
 */
export async function writeIfChanged(kv, path, body, previousHashes) {
  /* An empty body is never stored. Every source here has a real payload; an
   * empty one means something answered 200 with nothing, and caching that
   * globally for everyone is worse than one colo missing. */
  if (typeof body !== 'string' || body.length === 0) return 'skipped';

  const key = kvKey(path);
  const digest = await hash(body);
  if (previousHashes.get(key) === digest) return 'unchanged';

  await kv.put(key, body, {
    metadata: { fetchedAt: new Date().toISOString(), hash: digest },
  });
  previousHashes.set(key, digest);
  return 'written';
}
