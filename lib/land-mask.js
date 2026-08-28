/**
 * land-mask.js — read the prebuilt land mask and answer "is this point land?".
 * SPEC-SEASONS-BUILD.md §57.7b.
 *
 * The archive's landfalls are computed on the monthly runner and shipped as
 * answers, so no phone has ever needed a coastline. The season IN PROGRESS has
 * no reviewed record and no runner pass, so the only way to mark its landfalls
 * is to ask the question here. This is the half of `tools/land-raster.mjs`
 * that had to cross: the lookup, without the machinery that built it.
 *
 * ==> ONE BIT PER CELL, WHICH IS THE TRADE THE RASTERISER DELIBERATELY DID NOT
 * MAKE. <== `tools/land-raster.mjs` says out loud that it uses a byte per cell
 * because `TypedArray.fill` is what makes the scanline fill fast, and that if
 * it ever had to reach a browser "that decision flips". This is that flip. A
 * byte per cell is 119 MB, which no phone should hold; a bit per cell is
 * 14.85 MB, and the lookup pays one shift and one mask for it.
 *
 * ==> AND IT IS AFFORDABLE OVER THE WIRE FOR A REASON THAT IS ABOUT MAPS, NOT
 * ABOUT COMPRESSION. <== Measured 2026-08-28: the packed mask is 14.85 MB and
 * gzips to 0.30 MB — about fiftyfold. That is not luck. A raster of the Earth
 * is enormous runs of unbroken ocean and unbroken interior; only the coasts
 * carry any detail, and coasts are a rounding error of the planet's area. The
 * spec carried "~15 MB, almost certainly too much" for a fortnight because
 * nobody had measured the file, only computed its uncompressed size.
 *
 * A coarser mask was measured too and does not pay: at 0.05° the answer changes
 * for 31 of the 3,266 storms in the archive and at 0.1° for 54. There is no
 * cheap coarse version, so this ships at the archive's own 0.02°, which is what
 * makes the running season's answers comparable to 1851's.
 */

import { SEASONS } from '../config/constants.js';

/** ==> THE FILE DESCRIBES ITSELF AND THE CONSTANTS ARE ONLY CHECKED AGAINST
 *  IT. <== The mask's geometry — cell size, latitude band — is baked into the
 *  bytes at build time. If `config/constants.js` later moved `landfallMaskStep`
 *  and this file read the constant instead of the header, every lookup would be
 *  offset by the difference and return a wrong answer silently, on a file that
 *  is still perfectly valid. So the header is authoritative, the constants are
 *  asserted against it, and a mismatch is a loud error rather than a quiet
 *  continent shifted sideways. */
const MAGIC = 0x4c464d31; /* "LFM1" */
export const HEADER_BYTES = 32;

/** Gzip's own first two bytes. The mask is committed gzipped, but whether it
 *  arrives still gzipped depends on the host: a server that labels `.gz` with
 *  `Content-Encoding: gzip` makes the browser unwrap it before we ever see it,
 *  and one that treats it as an opaque download does not. Sniffing the bytes
 *  answers for both without caring which happened, and without a config file
 *  somewhere having to stay true. */
const GZIP_MAGIC = [0x1f, 0x8b];

const isGzip = (bytes) => bytes.length > 2
  && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];

/**
 * Parse packed mask bytes into a lookup.
 *
 * @param {ArrayBuffer|Uint8Array} buf  the unpacked `.bin` payload
 * @param {object} [opts]
 * @param {{step:number, latMin:number}|null} [opts.expect]  the geometry this
 *   caller was built against. Defaults to the constants, which is what the app
 *   always wants. A test building a deliberately coarse fixture passes its own;
 *   passing `null` skips the check and is not something the app should do.
 * @returns {{isLand:(lon:number,lat:number)=>boolean, width:number,
 *   height:number, step:number, latMin:number, latMax:number, cells:number}}
 */
export function readLandMask(buf, {
  expect = { step: SEASONS.landfallMaskStep, latMin: SEASONS.landfallMaskLatMin },
} = {}) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`land mask is ${bytes.length} bytes, too short to hold a header`);
  }

  const head = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES);
  if (head.getUint32(0, true) !== MAGIC) {
    throw new Error('land mask does not start with LFM1 — wrong file or a truncated download');
  }

  const step = head.getFloat64(8, true);
  const latMin = head.getFloat64(16, true);
  const width = head.getUint32(24, true);
  const height = head.getUint32(28, true);
  const latMax = latMin + height * step;
  const cells = width * height;

  const want = HEADER_BYTES + Math.ceil(cells / 8);
  if (bytes.length !== want) {
    throw new Error(`land mask is ${bytes.length} bytes, header describes ${want}`);
  }

  /* ==> THE EXPECTED GEOMETRY IS CHECKED, NOT USED. <== If the shipped file has
   * drifted from what this build was written against, the archive and the
   * running season are measuring different planets, and that is worth stopping
   * for rather than papering over. A mask read at the wrong step throws no
   * error on its own — it returns clean booleans for a world whose coastlines
   * have all moved. */
  if (expect && (step !== expect.step || latMin !== expect.latMin)) {
    throw new Error(
      `land mask is ${step}° from ${latMin}°, this build expects `
      + `${expect.step}° from ${expect.latMin}° — rebuild it`,
    );
  }

  const bits = bytes.subarray(HEADER_BYTES);

  /* The lookup is the rasteriser's, unchanged except for the bit unpack — see
   * `tools/land-raster.mjs` for why the wrap is double-modulo arithmetic and
   * not a loop. That was a real bug: a longitude needing two turns produced a
   * negative column and silently read the previous row. */
  const isLand = (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    if (lat < latMin || lat >= latMax) return false;
    const x = (((lon + 180) % 360) + 360) % 360;
    const col = Math.floor(x / step);
    const row = Math.floor((lat - latMin) / step);
    if (col < 0 || col >= width || row < 0 || row >= height) return false;
    const i = row * width + col;
    return (bits[i >> 3] & (1 << (i & 7))) !== 0;
  };

  return { isLand, width, height, step, latMin, latMax, cells };
}

/**
 * Fetch and parse the shipped mask.
 *
 * ==> IT IS FETCHED ONLY WHEN SOMETHING ASKS, NEVER ON THE BOOT PATH. <== A
 * reader who never opens the archive never pays for this, and a reader who does
 * pays about 0.30 MB once. The caller decides when; this only knows how.
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]  injectable for tests
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<ReturnType<typeof readLandMask>>}
 */
export async function loadLandMask({ fetchImpl = fetch, signal } = {}) {
  const res = await fetchImpl(SEASONS.landfallMaskUrl, { signal });
  if (!res.ok) throw new Error(`land mask ${res.status}`);

  let bytes = new Uint8Array(await res.arrayBuffer());

  /* ==> DECOMPRESSED HERE ONLY IF IT ARRIVED STILL COMPRESSED. <== See
   * `isGzip`. `DecompressionStream` is the platform's own gunzip; there is no
   * shipped inflate in this project and adding one would be a build step in
   * everything but name. */
  if (isGzip(bytes)) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('land mask arrived gzipped and this browser cannot unzip it');
    }
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }

  return readLandMask(bytes);
}
