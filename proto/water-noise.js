/**
 * water-noise.js — THE FINE DETAIL THE THREE WAVE TRAINS CANNOT PROVIDE.
 *
 * PROTOTYPE CODE. Used only by `proto/volcano-3d.js`.
 *
 * ==> WHY THIS EXISTS. <== The sea is lit from a surface normal built out of
 * three sine trains. At the zoom these sheets are looked at, those trains are
 * 250, 144 and 64 screen pixels — and there is NO structure below 64 px at all.
 * Real water has detail down to the pixel, and that is what makes a highlight
 * read as scattered sparkle rather than as a painted band. Without it, "this
 * pixel is bright" reduces to a condition on a smooth slope, which is a
 * continuous contour line running the width of the sheet. Two renders showed
 * exactly that: first as ribbons, then as a corrugated fingerprint.
 *
 * ==> AND MORE SINE TRAINS ARE THE WRONG ANSWER. <== Each one costs a `sin` and
 * a `cos` per pixel forever, and it takes a lot of them before a sum of sines
 * stops looking like a sum of sines. A texture sampled twice costs two lookups
 * regardless of how much detail is in it.
 *
 * ---------------------------------------------------------------------------
 * ==> IT STORES A SLOPE, NOT A NORMAL, AND THAT IS DELIBERATE. <== The usual
 * normal map packs a unit vector into RGB and the shader has to unpack it,
 * rescale it and re-normalise after blending. What the water shader actually
 * wants is a GRADIENT it can add to the gradient the sine trains already
 * produced, before either becomes a normal. Adding slopes is correct; averaging
 * two normalised vectors is an approximation that flattens whichever one is
 * steeper. So R and G carry dH/dx and dH/dy, and B and A are unused.
 *
 * ==> IT TILES EXACTLY, BY CONSTRUCTION RATHER THAN BY CARE. <== The noise is
 * built on a lattice whose neighbour lookups wrap with `% SIZE`, so the value at
 * one edge IS the value at the other — there is no seam to hide and no blending
 * band at the border. A generator that merely looks noisy will show its tile
 * boundary as a grid across the whole ocean, which is the failure this is meant
 * to cure wearing a different shape.
 *
 * `THREE` is a CDN global, same as everywhere else in `proto/`. `document` is
 * touched only when this is called, which is inside the layer's browser-only
 * setup — the headless tests construct that layer with a stub map and must
 * never reach this file.
 *
 * Imports: nothing.
 */

/** Texture edge, in texels. A power of two so mipmaps are available, and small
 *  because this is sampled at two scales and scrolled — a bigger tile buys
 *  detail that the second sample is already providing more cheaply. */
const SIZE = 256;

/** Octaves of value noise, coarsest first. Each entry is the lattice size in
 *  texels; each must DIVIDE `SIZE` or the wrap stops being exact and the seam
 *  comes back. Amplitude halves per octave, which is the ordinary 1/f falloff
 *  that makes noise read as natural rather than as a single grain size. */
const OCTAVES = [32, 16, 8, 4];

/** A deterministic hash, so the sea looks the same on every device and every
 *  reload. `Math.random()` here would mean a phone and a laptop disagree about
 *  a texture, which is exactly the sort of difference that wastes an afternoon
 *  when someone reports that the water looks wrong on one of them. */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep, so the lattice's cell edges do not show as creases. */
function fade(t) {
  return t * t * (3 - 2 * t);
}

/**
 * One octave of periodic value noise, sampled at texel (x, y).
 * `cell` is the lattice spacing in texels and must divide SIZE.
 */
function octave(x, y, cell) {
  const g = SIZE / cell;
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx) % g;
  const y0 = Math.floor(fy) % g;
  const x1 = (x0 + 1) % g;
  const y1 = (y0 + 1) % g;
  const tx = fade(fx - Math.floor(fx));
  const ty = fade(fy - Math.floor(fy));
  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}

/** The summed height field at one texel, roughly 0..1. */
function height(x, y) {
  let h = 0;
  let amp = 1;
  let total = 0;
  for (const cell of OCTAVES) {
    h += octave(x, y, cell) * amp;
    total += amp;
    amp *= 0.5;
  }
  return h / total;
}

/**
 * Build the tiling micro-slope texture.
 *
 * ==> THE SLOPE IS A CENTRAL DIFFERENCE ON A WRAPPED LATTICE. <== Neighbour
 * lookups use `(i + SIZE) % SIZE`, so a texel on the left edge differences
 * against the right edge and the gradient field is continuous across the seam
 * as well as the height field. Differencing with a clamped edge instead would
 * leave a one-texel line of wrong slope all the way round the tile, which lights
 * up as a bright grid the moment a specular highlight crosses it.
 *
 * The result is normalised so the steepest slope in the field reaches 1, which
 * makes `micro.strength` in the constants mean something stable: it is the peak
 * slope this layer contributes, in the same units as `wave.steepness`, rather
 * than a number that would shift whenever the octave list changed.
 *
 * @returns {object} a THREE.CanvasTexture, RG = slope in [-1, 1]
 */
export function createMicroSlopeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);

  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) h[y * SIZE + x] = height(x, y);
  }

  const gx = new Float32Array(SIZE * SIZE);
  const gy = new Float32Array(SIZE * SIZE);
  let peak = 1e-6;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const l = h[y * SIZE + ((x - 1 + SIZE) % SIZE)];
      const r = h[y * SIZE + ((x + 1) % SIZE)];
      const d = h[((y - 1 + SIZE) % SIZE) * SIZE + x];
      const u = h[((y + 1) % SIZE) * SIZE + x];
      const sx = (r - l) * 0.5;
      const sy = (u - d) * 0.5;
      gx[y * SIZE + x] = sx;
      gy[y * SIZE + x] = sy;
      peak = Math.max(peak, Math.abs(sx), Math.abs(sy));
    }
  }

  for (let i = 0; i < SIZE * SIZE; i++) {
    img.data[i * 4] = Math.round((gx[i] / peak) * 127.5 + 127.5);
    img.data[i * 4 + 1] = Math.round((gy[i] / peak) * 127.5 + 127.5);
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  /* Mipmaps matter here more than anywhere else on this layer: the finer of the
   * two samples repeats every few dozen screen pixels, so without them the
   * minified tile aliases into a shimmer that looks like the noise itself is
   * boiling. */
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}
