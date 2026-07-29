/**
 * land-mask.js — "is this point on land?" built from the coastlines we already ship.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * The usual way to do a dot-matrix globe is to download a black-and-white world
 * image and read its pixels. We don't need one: map/coastline.js already carries
 * every coastline as plain lon/lat data. This draws those rings into a small
 * hidden canvas once at startup and reads that instead. No new files, nothing
 * downloaded, and it is roughly a twentieth of the pixels the live globe's
 * 4096x2048 land texture costs.
 *
 * Imports: map/coastline.js only. Knows nothing about Three.js or any globe.
 */

import { RINGS } from '../map/coastline.js';

/** Below this latitude the map is filled solid — Antarctica's ring is open at
 *  the pole, same trick map/globe3d.js uses. */
const POLE_CAP_LAT = -82;

/**
 * Rasterise the coastlines and hand back a sampler.
 * @param {object} opts
 * @param {number} opts.width   mask width in pixels (equirectangular)
 * @param {number} opts.height  mask height in pixels
 * @returns {{width:number, height:number, isLand:(lon:number,lat:number)=>boolean, canvas:HTMLCanvasElement}}
 */
export function buildLandMask({ width = 1024, height = 512 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;

  const x = cv.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#000';
  x.fillRect(0, 0, width, height);
  x.fillStyle = '#fff';

  /* Draw one ring, unwrapping the jump where a shape crosses the antimeridian.
   * `shift` draws the same ring again 360 degrees left and right so shapes that
   * straddle the seam close properly instead of smearing across the map. */
  const drawRing = (ring, shift) => {
    let off = 0;
    let prev = null;
    x.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const lon = ring[i][0];
      const lat = ring[i][1];
      if (prev !== null) {
        if (lon - prev > 180) off -= 360;
        else if (lon - prev < -180) off += 360;
      }
      prev = lon;
      const px = ((lon + off + shift + 180) / 360) * width;
      const py = ((90 - lat) / 180) * height;
      if (i === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.closePath();
    x.fill();
  };

  for (const ring of RINGS) {
    drawRing(ring, 0);
    drawRing(ring, 360);
    drawRing(ring, -360);
  }

  const capY = ((90 - POLE_CAP_LAT) / 180) * height;
  x.fillRect(0, capY, width, height - capY);

  const data = x.getImageData(0, 0, width, height).data;

  return {
    width,
    height,
    canvas: cv,
    /** @returns {boolean} true if (lon, lat) falls on land. */
    isLand(lon, lat) {
      let px = Math.floor(((lon + 180) / 360) * width);
      let py = Math.floor(((90 - lat) / 180) * height);
      if (px < 0) px = 0;
      else if (px >= width) px = width - 1;
      if (py < 0) py = 0;
      else if (py >= height) py = height - 1;
      return data[(py * width + px) * 4] > 127;
    },
  };
}
