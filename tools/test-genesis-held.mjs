#!/usr/bin/env node
/**
 * test-genesis-held.mjs — an empty outlook layer is not an all-clear.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-genesis-held.mjs`.
 *
 * ==> THIS SUITE EXISTS BECAUSE THE APP SHIPPED A FALSE ALL-CLEAR. <==
 *
 * 2026-08-11, measured three ways within twenty minutes of each other:
 *
 *   NHC text product (ABNT20 KNHC 101744)  three Atlantic areas, one at 60%
 *   NHC public GTWO graphic                three Atlantic areas, one RED
 *   NHC GIS layer 3, which we read         {"count": 0}
 *
 * Landfall rendered the third one and said "Nothing being watched right now"
 * while the National Hurricane Center was publishing a high-chance development
 * area. The source was up. It answered 200. It was simply wrong.
 *
 * THE STRUCTURAL REASON IT COULD NOT BE CAUGHT DOWNSTREAM: an empty
 * FeatureCollection is UNSTAMPED. A populated response carries `idp_source`
 * ("gtwo_areas_202608101750") and `idp_filedate`; an empty one carries
 * nothing at all. So "NHC is watching nothing" and "NHC's layer is broken"
 * are byte-identical, and no parser, no matter how careful, can separate them.
 * The only thing that distinguishes them is what was on the wire an hour ago.
 *
 * So the relay remembers, and this suite pins the remembering.
 *
 * WHAT IT CANNOT PROVE: that Cloudflare's `caches.default` behaves the way the
 * fake below does under real edge conditions. The cache is stubbed. What is
 * proven is the DECISION — which body goes out, with which headers, for each
 * combination of upstream answer and memory.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { onRequestGet } = await import('../functions/api/nhc/genesis.js');

/* ---------------------------------------------------------------------------
 * FIXTURES — the real bytes, from origin/archive.
 * ------------------------------------------------------------------------- */

/** Three Atlantic + three Pacific areas, verbatim shape from the 17:50Z
 *  issuance. Trimmed to properties: the held decision never reads geometry. */
const POPULATED = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { basin: 'Atlantic', prob2day: '20%', risk2day: 'Low', prob7day: '60%', risk7day: 'Medium', idp_source: 'gtwo_areas_202608101750' }, geometry: null },
    { type: 'Feature', properties: { basin: 'Atlantic', prob2day: '10%', risk2day: 'Low', prob7day: '10%', risk7day: 'Low', idp_source: 'gtwo_areas_202608101750' }, geometry: null },
    { type: 'Feature', properties: { basin: 'Pacific', prob2day: '50%', risk2day: 'Medium', prob7day: '90%', risk7day: 'High', idp_source: 'gtwo_areas_202608101750' }, geometry: null },
  ],
});

/** EXACTLY what layer 3 returned at 02:17Z. Forty-two bytes, no stamp. */
const EMPTY = '{"type":"FeatureCollection","features":[]}';

/* --- a fake Cloudflare cache and fetch ------------------------------------ */

function makeCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const r = store.get(req.url);
      return r ? r.clone() : undefined;
    },
    async put(req, res) {
      store.set(req.url, res.clone());
    },
  };
}

function install({ upstreamBody, upstreamStatus = 200 }) {
  const cache = makeCache();
  globalThis.caches = { default: cache };
  globalThis.fetch = async () =>
    new Response(upstreamBody, {
      status: upstreamStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  return cache;
}

const ctx = () => ({
  request: { url: 'https://landfall.getgravitate.app/api/nhc/genesis?part=areas' },
  waitUntil: (p) => p,
});

const read = async (res) => ({
  status: res.status,
  body: await res.text(),
  stale: res.headers.get('X-Landfall-Stale'),
  held: res.headers.get('X-Landfall-Held'),
  fetchedAt: res.headers.get('X-Landfall-Fetched-At'),
});

/* ---------------------------------------------------------------------------
 * 1. THE ORDINARY PATH IS UNCHANGED
 * ------------------------------------------------------------------------- */

section('A populated answer passes straight through');

{
  install({ upstreamBody: POPULATED });
  const r = await read(await onRequestGet(ctx()));
  ok(r.body === POPULATED, 'a populated response is returned verbatim');
  ok(r.stale !== 'true', 'and is NOT marked stale');
  ok(r.held == null || r.held === '', 'and is NOT marked held');
  ok(JSON.parse(r.body).features.length === 3, 'all three areas survive');
}

section('An empty answer with NO memory is believed — a real all-clear');

{
  install({ upstreamBody: EMPTY });
  const r = await read(await onRequestGet(ctx()));
  ok(r.body === EMPTY, 'with nothing remembered, empty is served as-is');
  ok(r.stale !== 'true', 'and is not dressed up as stale');
  /* THE ALL-CLEAR MUST STILL BE REACHABLE. Most of the year NHC watches
   * nothing, and a fix for a false all-clear that makes a TRUE one impossible
   * has just moved the lie. */
  ok(JSON.parse(r.body).features.length === 0, 'a genuine all-clear still gets through');
}

/* ---------------------------------------------------------------------------
 * 2. THE NIGHT THIS WAS WRITTEN FOR
 * ------------------------------------------------------------------------- */

section('Six areas, then zero — the 2026-08-11 transition');

{
  /* First poll: the 17:50Z outlook lands and is remembered. */
  const cache = install({ upstreamBody: POPULATED });
  await onRequestGet(ctx());

  /* ==> THE REMEMBERED STAMP IS PINNED TO A KNOWN VALUE, AND IT HAS TO BE.
   * <== The first version of this asserted only that the held response
   * carried something ISO-shaped, which is true of `new Date().toISOString()`
   * as well — so a mutation stamping the held body with NOW passed. The whole
   * point of the branch is that the age is the OLD one; the test has to be
   * able to see the difference. */
  const KNOWN = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const lgKey = 'https://landfall-relay.internal/nhc/genesis/areas/last-good';
  const lg = cache.store.get(lgKey);
  cache.store.set(
    lgKey,
    new Response(await lg.clone().text(), { headers: { 'X-Landfall-Fetched-At': KNOWN } })
  );

  /* Second poll: NHC's layer answers 200 with nothing. Drop the fresh copy so
   * the request actually reaches upstream, exactly as it would fifteen
   * minutes later. */
  cache.store.delete('https://landfall-relay.internal/nhc/genesis/areas/fresh');
  globalThis.fetch = async () => new Response(EMPTY, { status: 200 });

  const r = await read(await onRequestGet(ctx()));

  ok(
    JSON.parse(r.body).features.length === 3,
    'THE HEADLINE: the three areas are still served when the layer goes empty — ' +
      `got ${JSON.parse(r.body).features.length}`
  );
  ok(r.stale === 'true', 'and the response says it is stale');
  ok(r.held === 'upstream-empty', 'and says WHY it is being held');
  ok(
    r.fetchedAt === KNOWN,
    'and carries the ORIGINAL fetch time, not the moment it was re-served — ' +
      'the client can only say "from 90 minutes ago" if this is the old stamp. ' +
      `Expected ${KNOWN}, got ${r.fetchedAt}`
  );
}

section('The caveat survives the next fifteen minutes of cache hits');

{
  const cache = install({ upstreamBody: POPULATED });
  await onRequestGet(ctx());
  cache.store.delete('https://landfall-relay.internal/nhc/genesis/areas/fresh');
  globalThis.fetch = async () => new Response(EMPTY, { status: 200 });
  const first = await read(await onRequestGet(ctx()));

  /* Now a plain cache hit — no upstream call at all. */
  globalThis.fetch = async () => {
    throw new Error('upstream must not be called on a fresh hit');
  };
  const second = await read(await onRequestGet(ctx()));

  ok(second.body === first.body, 'the cache hit serves the same held body');
  ok(
    second.stale === 'true' && second.held === 'upstream-empty',
    'AND KEEPS THE MARKERS. A caveat that survives one request and evaporates ' +
      'for the next fifteen minutes is worse than no caveat at all'
  );
  ok(second.fetchedAt === first.fetchedAt, 'the age does not reset on a cache hit');
}

section('Past one outlook cycle, the emptiness is believed');

{
  const cache = install({ upstreamBody: POPULATED });
  await onRequestGet(ctx());

  /* Age the remembered answer past HELD_SECONDS by rewriting its stamp. A
   * forecaster has had a full turn and published nothing. */
  const key = 'https://landfall-relay.internal/nhc/genesis/areas/last-good';
  const old = cache.store.get(key);
  const oldBody = await old.clone().text();
  cache.store.set(
    key,
    new Response(oldBody, {
      headers: {
        'X-Landfall-Fetched-At': new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      },
    })
  );
  cache.store.delete('https://landfall-relay.internal/nhc/genesis/areas/fresh');
  globalThis.fetch = async () => new Response(EMPTY, { status: 200 });

  const r = await read(await onRequestGet(ctx()));
  ok(
    JSON.parse(r.body).features.length === 0,
    'seven hours on, the empty answer is served — the hold is a gap-bridge, not a freeze'
  );
  ok(r.stale !== 'true', 'and it is not marked stale, because it is current and true');
}

/* ---------------------------------------------------------------------------
 * 3. THE CLIENT AND THE SENTENCE
 * ------------------------------------------------------------------------- */

section('The client marks held, and the section says so');

{
  const g = fs.readFileSync('data/genesis.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/held:\s*!!extra\.held/.test(g), 'slot() carries `held` — it drops anything it does not name');
  ok(/held:\s*relayStale && areas\.length > 0/.test(g), 'a held answer with areas is flagged');
  ok(
    !/status:\s*'unavailable'[\s\S]{0,80}held/.test(g),
    'held does NOT become unavailable — that would blank the very patches this keeps on screen'
  );

  const v = fs.readFileSync('ui/view-storms.js', 'utf8');
  ok(/heldNote/.test(v), 'the section builds a held note');
  ok(
    /stopped publishing/.test(v),
    'and says the layer stopped publishing, rather than implying the areas are current'
  );
  ok(/list-held/.test(v), 'the note has its own class, separate from list-error');

  const css = fs.readFileSync('ui/panels.css', 'utf8');
  ok(
    /\.list-held\s*\{\s*color:\s*var\(--stale\)/.test(css),
    '.list-held is amber (a stopped clock), never --error (a failed request)'
  );
}

/* ------------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed\n`);
