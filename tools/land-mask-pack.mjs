/**
 * land-mask-pack.mjs — build the packed land mask the browser reads.
 * SPEC-SEASONS-BUILD.md §57.7b. RUNNER ONLY.
 *
 *   node tools/land-mask-pack.mjs            build and write it
 *   node tools/land-mask-pack.mjs --measure  print sizes, write nothing
 *
 * Rasterises the same pinned Natural Earth coastline the archive is measured
 * against, packs it one bit per cell, prepends a header that describes the
 * geometry, and gzips it. `lib/land-mask.js` reads the result.
 *
 * ==> IT IS BUILT FROM THE SAME RINGS AND THE SAME CELL SIZE AS THE ARCHIVE,
 * AND THAT IS THE ENTIRE POINT. <== If the running season were measured against
 * a different coastline or a coarser grid, 2026 and 1851 would be answering
 * different questions and the wall would be comparing them side by side anyway.
 * Same pin, same step, same walk.
 */

import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { SEASONS } from '../config/constants.js';
import { buildLandMask } from './land-raster.mjs';
import { fetchCoastline } from './seasons-landfall.mjs';
import { HEADER_BYTES } from '../lib/land-mask.js';

const MAGIC = 0x4c464d31; /* "LFM1" — matches lib/land-mask.js */

/**
 * Pack a built mask into the shipped byte layout.
 *
 * ==> THE HEADER EXISTS SO THE FILE CANNOT BE MISREAD BY CODE THAT DISAGREES
 * WITH IT. <== Cell size and latitude floor are written in; the reader asserts
 * the constants still match rather than assuming they do. A mask read at the
 * wrong step is not an error, it is every coastline on Earth shifted sideways,
 * which is precisely the kind of wrong answer that ships.
 *
 * @param {ReturnType<typeof buildLandMask>} mask
 * @returns {Uint8Array}
 */
export function packLandMask(mask) {
  const { width, height, step, latMin, isLand } = mask;
  const cells = width * height;
  const out = new Uint8Array(HEADER_BYTES + Math.ceil(cells / 8));

  const head = new DataView(out.buffer, 0, HEADER_BYTES);
  head.setUint32(0, MAGIC, true);
  head.setFloat64(8, step, true);
  head.setFloat64(16, latMin, true);
  head.setUint32(24, width, true);
  head.setUint32(28, height, true);

  const bits = out.subarray(HEADER_BYTES);
  let i = 0;
  for (let row = 0; row < height; row++) {
    const lat = latMin + (row + 0.5) * step;
    for (let col = 0; col < width; col++) {
      const lon = -180 + (col + 0.5) * step;
      if (isLand(lon, lat)) bits[i >> 3] |= (1 << (i & 7));
      i++;
    }
  }
  return out;
}

/* --- run it -------------------------------------------------------------- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const measureOnly = process.argv.includes('--measure');

  console.log('loading the pinned coastline...');
  const coast = await fetchCoastline();
  console.log(`  ${coast.rings.length} rings`);

  console.log(`rasterising at ${SEASONS.landfallMaskStep}°...`);
  const mask = buildLandMask(coast.rings);
  console.log(`  ${mask.width} x ${mask.height} = ${mask.cells.toLocaleString()} cells`);

  const packed = packLandMask(mask);
  const gz = gzipSync(packed, { level: 9 });

  const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
  console.log(`  one byte per cell : ${mb(mask.cells)}`);
  console.log(`  packed to bits    : ${mb(packed.length)}`);
  console.log(`  gzipped           : ${mb(gz.length)}`);

  if (measureOnly) {
    console.log('\n--measure: nothing written.');
  } else {
    const out = new URL(`..${SEASONS.landfallMaskUrl}`, import.meta.url);
    writeFileSync(out, gz);
    console.log(`\nwrote ${SEASONS.landfallMaskUrl} (${mb(gz.length)})`);
  }
}
