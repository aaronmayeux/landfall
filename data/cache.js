/**
 * cache.js — client-side per-(storm, advisory) geometry cache (SPEC §7).
 *
 * The key is the storm's `advisoryKey`, so a new advisory self-invalidates:
 * nothing here ever needs a timer. The LRU cap (CACHE.geometryLruStorms)
 * stops unbounded growth across a long session — bound every cache.
 *
 * FAILURES ARE CACHED TOO. A dead layer must not refetch on every render;
 * re-selecting the storm (or re-toggling the layer) means "try again", and
 * that path calls `evict()` first. The toggle is the recovery (SPEC §5/§7).
 *
 * No DOM, ever. Imports: config/ only.
 */

import { CACHE } from '../config/constants.js';

/** Map preserves insertion order — delete+set on read makes it an LRU. */
const store = new Map();

export function getGeometry(advisoryKey) {
  if (!store.has(advisoryKey)) return null;
  const v = store.get(advisoryKey);
  store.delete(advisoryKey);
  store.set(advisoryKey, v); // refresh recency
  return v;
}

export function putGeometry(advisoryKey, bundle) {
  if (store.has(advisoryKey)) store.delete(advisoryKey);
  store.set(advisoryKey, bundle);
  while (store.size > CACHE.geometryLruStorms) {
    store.delete(store.keys().next().value); // oldest first
  }
  return bundle;
}

/** Explicit retry path: re-selection clears the cached entry (including a
 *  cached failure) so the next fetch is real. */
export function evictGeometry(advisoryKey) {
  store.delete(advisoryKey);
}
