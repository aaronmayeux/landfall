/**
 * imagery-cache.js — the vendor-frame cache (SPEC §4).
 *
 * WHAT PROBLEM THIS SOLVES, in Aaron's words: "it looks like we are actually
 * redownloading the same images at times. Like if i toggle to radar as soon as
 * the satellite imagery loads, then switch back, it looks to be redownloading."
 * He was right. It was, every time, and the numbers are in `IMAGERY.cache`.
 *
 * ==> WHY THE BYTES WERE THROWN AWAY <==
 *
 * `map/imagery.js` held one frame per DISC (`rec.blob`), and `setMode` drops
 * every disc record — so the bytes died with the record on every toggle even
 * though the very next thing the user did was ask for them back. The cache
 * being keyed to the disc was the bug: a frame is not a property of a disc, it
 * is the answer to a REQUEST, and the same request can be asked again after the
 * disc that first asked it is gone.
 *
 * ==> THE KEY IS THE REQUEST URL, AND THAT IS DELIBERATE <==
 *
 * The URL already encodes every axis that makes a frame distinct: which mode
 * (our radar relay path versus the satellite one), which bird (the WMS LAYERS
 * value), which box (BBOX), and what size (WIDTH/HEIGHT). Building a separate
 * composite key from those same parts would be a second spelling of one fact,
 * free to disagree with the URL actually fetched — and a cache that can key a
 * frame under a name that does not match the bytes is worse than no cache.
 * One string, no mapping to get wrong.
 *
 * This works because we send NO TIME PARAMETER (see IMAGERY_SENDS_NO_TIME): the
 * URL for a given storm and box is stable across refreshes, which is exactly
 * what makes it a usable cache key. If playback ever lands and starts sending
 * explicit times, the URL gains a time component and this keys per-frame for
 * free — no change needed here.
 *
 * ==> WHAT IT DOES NOT DO <==
 *
 * It does not persist. Nothing here touches the Cache API or storage: this is a
 * session-lifetime Map, and a cold start still fetches. The satellite relay's
 * own `max-age=300` is what makes a cold start fast, and it lives at the edge
 * where it can be shared between every reader rather than per-device.
 *
 * It does not decide policy. `age()` reports, `get()` refuses to return
 * anything past `maxServeAge`, and WHETHER a servable-but-aging frame should
 * also trigger a refresh is the caller's call — map/imagery.js owns the poll
 * timer and is the only thing that can answer that.
 *
 * Pure module, no DOM, no fetching. Imports config/ only.
 */

import { IMAGERY } from '../config/constants.js';

/** url -> { blob, fetchedAt }. Map preserves insertion order, so delete+set on
 *  read makes it an LRU — the same three lines data/cache.js uses, on purpose:
 *  two different eviction mechanisms in one app is two things to reason about. */
const store = new Map();

/** ms since this frame was downloaded, or null if we do not hold it.
 *
 *  SEPARATE FROM `get()` because the caller needs the age even when it is about
 *  to fetch anyway — the row reports "Downloaded 12 min ago" while a refresh
 *  runs behind it, and folding age into the get would make that unreachable. */
export function frameAge(url, now = Date.now()) {
  const hit = store.get(url);
  return hit ? now - hit.fetchedAt : null;
}

/**
 * The cached frame for this request, or null.
 *
 * REFUSES A FRAME PAST `maxServeAge` rather than returning it with a warning
 * flag, because a caller that has to remember to check a flag is a caller that
 * will one day forget, and the failure mode is an hour-old sky presented as
 * current (§5). Too old is the same as absent, and the entry is dropped on the
 * way out so it cannot be found again.
 *
 * Returns `{ blob, fetchedAt, ageMs }`.
 */
export function getFrame(url, now = Date.now()) {
  const hit = store.get(url);
  if (!hit) return null;

  const ageMs = now - hit.fetchedAt;
  if (ageMs > IMAGERY.cache.maxServeAge) {
    store.delete(url);
    return null;
  }

  store.delete(url);
  store.set(url, hit); // refresh recency
  return { blob: hit.blob, fetchedAt: hit.fetchedAt, ageMs };
}

/**
 * Is this frame current enough that no refetch is warranted?
 *
 * Not the same question as `getFrame` returning something. A frame can be worth
 * SHOWING for an hour and worth REPLACING after five minutes, and collapsing
 * those two into one threshold is how a cache starts lying about freshness.
 */
export function isCurrent(url, now = Date.now()) {
  const age = frameAge(url, now);
  return age != null && age <= IMAGERY.cache.currentFor;
}

/** Store a frame against the request that fetched it. */
export function putFrame(url, blob, now = Date.now()) {
  if (!url || !blob) return;
  if (store.has(url)) store.delete(url);
  store.set(url, { blob, fetchedAt: now });
  while (store.size > IMAGERY.cache.maxFrames) {
    store.delete(store.keys().next().value); // oldest first
  }
}

/** Forget one frame. The retry path uses this: re-tapping an errored segment
 *  means "try again", and a cached copy would answer the retry with the same
 *  bytes that were already on screen. */
export function evictFrame(url) {
  store.delete(url);
}

/**
 * Drop everything.
 *
 * The one caller is `destroy()`. NOT called on a mode switch — that is the
 * whole point of this file, and it is worth saying out loud next to a function
 * whose name invites exactly that use.
 */
export function clearFrames() {
  store.clear();
}

/** How many frames are held. For diagnostics and tests; nothing renders it. */
export const frameCount = () => store.size;
