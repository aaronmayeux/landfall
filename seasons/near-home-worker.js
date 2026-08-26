/**
 * near-home-worker.js — 175 years of track, measured against one house,
 * without touching the main thread.
 * SPEC-SEASONS-BUILD.md §57.19, §57.35 faults 1 and 2, §57.30 step 9.
 *
 * ==> THIS FILE IS A SHIM AND THAT IS DELIBERATE. <== Everything it does is
 * three calls into modules that are plain ES modules with no DOM in them, so
 * the whole of the arithmetic is reachable from `node` and is covered by
 * `tools/test-near-home.mjs` and `tools/test-near-home-index.mjs`. Nothing in
 * this sandbox can start a Web Worker, so any logic living HERE would be logic
 * no suite can run — and this is the one place in the feature where a silent
 * wrong answer is least likely to be noticed, because nobody is watching a
 * background thread.
 *
 * ==> THE FETCH HAPPENS IN HERE, NOT OUTSIDE. <== The two whole-basin files
 * are 10.65 MB of text between them. Fetched on the main thread and handed
 * across, that string would be copied into this worker's heap and the copy
 * itself would block — so the page would pay most of the cost it started a
 * worker to avoid. Fetched here, the main thread never sees a byte of HURDAT2:
 * what crosses back is a few hundred numbers.
 *
 * ==> AND IT IS ONE MESSAGE IN, ONE MESSAGE OUT, WITH NO STATE. <== No cache,
 * no queue, no second request while the first is in flight. The facade
 * (`data/near-home-index.js`) owns every one of those questions, and a worker
 * that also had opinions about them would be a second place they are decided.
 *
 * ==> A FAILURE COMES BACK AS A MESSAGE, NEVER AS SILENCE. <== §5. A worker
 * that throws fires `onerror` on the page, which is a different channel with a
 * different shape and is easy to leave unhandled — so every road out of here
 * posts something, and the facade has exactly one thing to listen to.
 *
 * Imports lib/ only. Same-origin fetch, which `worker-src 'self'` and
 * `connect-src 'self'` in `_headers` already permit — no CSP change was needed
 * for this file and none should be added for it.
 */

import { parseHurdat2 } from '../lib/hurdat.js';
import { indexNearHome, within } from '../lib/near-home.js';
import { SEASONS } from '../config/constants.js';

/**
 * @param {MessageEvent} e
 * @param {object} e.data
 * @param {Array<{basin:string, url:string}>} e.data.files  whole-basin files
 * @param {{lon:number, lat:number}} e.data.home
 */
self.onmessage = async (e) => {
  const { files, home } = e.data || {};
  try {
    let storms = [];

    for (const f of files || []) {
      const res = await fetch(f.url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`${f.url} answered ${res.status}`);
      const parsed = parseHurdat2(await res.text());
      /* ==> THE BASIN IS STAMPED FROM THE FILE IT CAME OUT OF. <== HURDAT2's
       * own storm ids carry a basin prefix and `lib/hurdat.js` reads it, so
       * this is a fallback rather than a correction — but the East Pacific
       * file holds Central Pacific storms too (§57.18b), and a storm whose id
       * this parser could not read must not end up in the index with no basin
       * at all when the file it was in knows the answer. */
      for (const s of parsed.storms) if (!s.basin) s.basin = f.basin;
      storms = storms.concat(parsed.storms);
    }

    /* ==> TRIMMED BEFORE IT CROSSES, NOT AFTER. <== `indexNearHome` returns an
     * entry per storm — 3,266 of them, 554 KB of JSON, measured. The slider
     * cannot ask about anything past `nearHomeKeepMi`, so everything beyond it
     * is weight with no question behind it: copying it across the thread
     * boundary and then into the reader's storage would be paying twice to
     * keep an answer nobody can request. */
    const index = within(indexNearHome(storms, home), SEASONS.nearHomeKeepMi);

    self.postMessage({ ok: true, index, storms: storms.length });
  } catch (err) {
    self.postMessage({ ok: false, reason: String(err?.message || err) });
  }
};
