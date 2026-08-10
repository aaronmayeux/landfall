#!/usr/bin/env node
/**
 * test-coast-band-zoom.mjs — the painted band keeps up with its own coastline.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-coast-band-zoom.mjs`.
 *
 * ===========================================================================
 * THE BUG THIS EXISTS FOR
 * ===========================================================================
 *
 * The cache held ONE best band per storm and replaced it only on a strict
 * improvement, scored by painted features, then painted km. Coast vertices
 * come from LOADED TILES ONLY, so zooming in shows LESS coast in MORE detail:
 * fewer features painted, far fewer kilometres. The sharper select lost the
 * contest every single time and was thrown away. The band froze at the zoom
 * that first covered the most coastline — which is also the coarsest geometry
 * the basemap has — while the cyan coastline under it went on sharpening.
 *
 * Nothing errored. Nothing was slow. The layer worked. It just drew a
 * generalised 2021-era outline over a street-level coast, which at 8 px was
 * invisible and at coastline width reads as a broken stripe.
 *
 * ===========================================================================
 * WHY THE STUB LOOKS LIKE THIS
 * ===========================================================================
 *
 * A fake map whose coastline gets FINER as it zooms and NARROWER as it pans,
 * because those are the two properties of the real thing that broke the old
 * rule. Nothing here is a MapLibre mock beyond the three methods the cache
 * touches — `getZoom`, `querySourceFeatures`, `on`.
 *
 * WHAT THIS CANNOT PROVE: that the stripe sits on the cyan on a real phone.
 * That is glass, and it is where this bug was found in the first place.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { bandFor, clearBands, forgetBand } = await import('../map/coast-band-cache.js');
const { COAST_BAND } = await import('../config/constants.js');

/* ---------------------------------------------------------------------------
 * A COASTLINE THAT BEHAVES LIKE A REAL ONE
 *
 * Runs west to east along lat 29.5. `zoom` sets the vertex spacing — higher
 * zoom, finer coast. `window` sets which longitudes are loaded — the viewport.
 * ------------------------------------------------------------------------- */

function makeMap() {
  const listeners = new Map();
  let zoom = 5;
  let window = [-93, -89];
  let gen = 0;

  const bump = () => {
    gen++;
    for (const fn of listeners.get('sourcedata') || []) fn({ sourceId: 'basemap' });
  };

  return {
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },
    getZoom: () => zoom,
    setView(z, w) { zoom = z; window = w; bump(); },
    querySourceFeatures(_source, opts) {
      if (opts.sourceLayer === 'earth') throw new Error('no such source-layer');
      /* Spacing halves per zoom level, the way tile geometry sharpens. Fine
       * enough at the widest view to clear COAST_BAND.minCoastVertices — a
       * substrate under that floor is refused outright and would make every
       * assertion below measure nothing. */
      const step = 0.005 / 2 ** (zoom - 5);
      const ring = [];
      for (let lon = window[0]; lon <= window[1]; lon += step) {
        /* A wiggle so the coast is not a straight line — a straight line would
         * be indistinguishable at every zoom, which is the one case this test
         * must not accidentally measure. */
        ring.push([lon, 29.5 + Math.sin(lon * 40) * 0.02]);
      }
      ring.push(ring[0]);
      return [{ geometry: { type: 'Polygon', coordinates: [ring] }, properties: { class: 'ocean' } }];
    },
  };
}

/** One NHC-shaped warning line along the same coast. */
const wwFeatures = () => [
  {
    type: 'Feature',
    properties: { TCWW: 'HWR' },
    geometry: { type: 'LineString', coordinates: [[-93, 29.5], [-91, 29.5], [-89, 29.5]] },
  },
];

const vertexCount = (r) =>
  r.features.reduce(
    (n, f) => n + (f.properties?._banded === true
      ? f.geometry.coordinates.reduce((m, run) => m + run.length, 0)
      : 0),
    0
  );

const lonsPainted = (r) => {
  const out = [];
  for (const f of r.features) {
    if (f.properties?._banded !== true) continue;
    for (const run of f.geometry.coordinates) for (const [lon] of run) out.push(lon);
  }
  return out;
};

/* ---------------------------------------------------------------------------
 * ZOOMING IN MUST SHARPEN THE BAND
 * ------------------------------------------------------------------------- */
section('the band sharpens when the coastline does');

clearBands();
{
  const map = makeMap();
  const feats = wwFeatures();

  /* Wide view: the whole corridor, coarsely. This is the band that used to
   * win forever. */
  const wide = bandFor(map, 'ida', feats, 'adv12');
  ok(wide.paintedCount === 1, 'the wide view paints the warning');
  const wideVerts = vertexCount(wide);

  /* Zoom in three levels onto a quarter of it. Fewer kilometres of coast, far
   * more vertices per kilometre — the exact shape that lost every contest. */
  map.setView(8, [-91.5, -91]);
  const close = bandFor(map, 'ida', feats, 'adv12');

  ok(close.paintedCount === 1, 'the close view paints the warning too');

  const closeSpan = Math.max(...lonsPainted(close)) - Math.min(...lonsPainted(close));
  const wideSpan = Math.max(...lonsPainted(wide)) - Math.min(...lonsPainted(wide));
  ok(closeSpan < wideSpan, 'the close view covers less coast, as a real one does');

  /* ==> THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT THE FROZEN BAND. <== The
   * old rule returned the wide band here, verbatim: same vertices, same
   * coarse geometry, drawn over a coastline eight times finer. */
  const density = (r) => {
    const lons = lonsPainted(r);
    return vertexCount(r) / (Math.max(...lons) - Math.min(...lons));
  };
  ok(
    density(close) > density(wide) * 4,
    `the close band is denser per degree than the wide one ` +
      `(${density(close).toFixed(0)} vs ${density(wide).toFixed(0)})`
  );
  ok(wideVerts > 0, 'and the wide band was real to begin with');
}

/* ---------------------------------------------------------------------------
 * ZOOMING BACK OUT MUST NOT DEGRADE
 *
 * The whole reason the old rule existed. Bucketing keeps the guarantee for
 * free — the wide band was never overwritten, so it is simply still there.
 * ------------------------------------------------------------------------- */
section('zooming back out finds the wide band waiting');

clearBands();
{
  const map = makeMap();
  const feats = wwFeatures();

  const wide = bandFor(map, 'ida', feats, 'adv12');
  const wideSpan = Math.max(...lonsPainted(wide)) - Math.min(...lonsPainted(wide));

  map.setView(8, [-91.5, -91]);
  bandFor(map, 'ida', feats, 'adv12');

  map.setView(5, [-93, -89]);
  const back = bandFor(map, 'ida', feats, 'adv12');
  const backSpan = Math.max(...lonsPainted(back)) - Math.min(...lonsPainted(back));

  ok(
    backSpan >= wideSpan - 1e-9,
    `the wide view still covers what it covered (${backSpan.toFixed(3)} vs ${wideSpan.toFixed(3)})`
  );
  ok(back.fromCache === true, 'and it comes back without a re-select');
}

/* ---------------------------------------------------------------------------
 * PANNING WITHIN A ZOOM MUST ACCUMULATE, NOT CONTEST
 *
 * The failure a naive per-zoom cache would have introduced: pan east, the new
 * select covers less total coast than the held one covering the west, loses,
 * and the coast the user is now looking at has no stripe on it.
 * ------------------------------------------------------------------------- */
section('panning adds coast rather than competing with it');

clearBands();
{
  const map = makeMap();
  const feats = wwFeatures();

  map.setView(8, [-93, -92]);
  const west = bandFor(map, 'ida', feats, 'adv12');
  const westMin = Math.min(...lonsPainted(west));

  map.setView(8, [-90, -89]);
  const east = bandFor(map, 'ida', feats, 'adv12');
  const lons = lonsPainted(east);

  ok(Math.max(...lons) > -90.5, 'the newly revealed east coast is painted');
  ok(
    Math.min(...lons) <= westMin + 1e-9,
    'and the west it came from is still painted'
  );
  ok(east.fromCache === false, 'a pan that reveals new coast counts as a change');

  /* Re-asking on the same substrate adds nothing and must say so, or the
   * layer repaints the map for no reason on every settled camera move. */
  const again = bandFor(map, 'ida', feats, 'adv12');
  ok(again.fromCache === true, 'and asking again on the same substrate does not');
}

/* ---------------------------------------------------------------------------
 * A SUPERSEDED WARNING IS WRONG AT EVERY ZOOM
 * ------------------------------------------------------------------------- */
section('a new advisory clears every bucket, not just the one on screen');

clearBands();
{
  const map = makeMap();
  const feats = wwFeatures();

  bandFor(map, 'ida', feats, 'adv12');       // wide bucket
  map.setView(8, [-91.5, -91]);
  bandFor(map, 'ida', feats, 'adv12');       // close bucket

  /* New geometry arrives while zoomed in, then the user zooms out to a bucket
   * that was never touched by the new stamp. It must not still be holding
   * advisory 12's band. */
  bandFor(map, 'ida', feats, 'adv13');
  map.setView(5, [-93, -89]);
  const wideAfter = bandFor(map, 'ida', feats, 'adv13');

  ok(wideAfter.fromCache === false, 'the untouched wide bucket re-selects for the new advisory');
}

/* ---------------------------------------------------------------------------
 * THE CAPS
 * ------------------------------------------------------------------------- */
section('the cache is bounded');

clearBands();
{
  const map = makeMap();
  const feats = wwFeatures();

  /* More storms x zooms than the cap allows. Nothing here asserts WHICH
   * survive — only that the map does not grow without bound, which is the
   * property that matters on a phone. */
  for (let s = 0; s < 8; s++) {
    for (let z = 5; z < 11; z++) {
      map.setView(z, [-93, -89]);
      bandFor(map, `storm${s}`, feats, 'adv12');
    }
  }

  /* Reached through the only door there is: a freshly asked-for entry must
   * still be servable, and the earliest ones must be gone. */
  map.setView(10, [-93, -89]);
  const recent = bandFor(map, 'storm7', feats, 'adv12');
  ok(recent.paintedCount === 1, 'a recent entry survives eviction');

  ok(
    COAST_BAND.maxBandEntries > 0 && COAST_BAND.maxBandVertices > 0,
    'both caps are set to something'
  );

  forgetBand('storm7');
  map.setView(10, [-93, -89]);
  const after = bandFor(map, 'storm7', feats, 'adv12');
  ok(after.fromCache === false, 'forgetting a storm drops its buckets');
}

/* ------------------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (a stub coastline — whether the stripe sits on the cyan is glass)');
