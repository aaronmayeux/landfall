/**
 * scene-copy.js — A COPY OF THE WORLD AS IT LOOKS UNDER THE SEA, SO THE SEA CAN
 * REFRACT IT.
 *
 * PROTOTYPE CODE. Used only by `proto/volcano-3d.js`.
 *
 * ==> WHY IT IS NOT `proto/basemap-mask.js`. <== That file also copies the
 * framebuffer, and merging the two is the obvious-looking mistake here. They
 * photograph the same buffer at two different MOMENTS, to answer two questions
 * that want opposite things in the frame:
 *
 *   THE MASK wants the picture with NOTHING in it but the ocean fill and the
 *   land fill, because its shoreline test asks which of two known colours a
 *   pixel is nearer to. A coastline glow or an orange plate seam in that
 *   picture punches holes through the sea wherever one crosses. So it is taken
 *   from a layer placed LOW in the MapLibre style.
 *
 *   THIS wants the picture with as MUCH in it as possible — basemap, coastline,
 *   seams, labels and the seamounts themselves — because a refraction shows you
 *   whatever is actually down there. So it is taken from inside the volcano
 *   layer, after the terrain has drawn and before the water does.
 *
 * Feed either one to the other's consumer and it fails quietly: the shoreline
 * cut starts eating holes around mountains, or the refraction wobbles a
 * two-colour stencil and shows nothing.
 *
 * ==> IT IS NOT A MAPLIBRE LAYER AT ALL, AND THAT IS THE OTHER DIFFERENCE. <==
 * The mask has to be a layer because it needs a specific position in MapLibre's
 * draw order. This one only needs a position in OURS, which is a line of
 * JavaScript between two `renderer.render()` calls.
 *
 * ==> THE COPY IS SKIPPED WHENEVER IT WOULD PRODUCE THE SAME PICTURE. <== It is
 * a full-screen GPU blit and the sea animates, so a naive version pays it on
 * every frame the wave already forces. But nothing under the water moves on its
 * own — the mountains are static geometry and MapLibre repaints an identical
 * basemap when the camera has not moved — so a copy taken last frame is not
 * stale, it is the same photograph. It therefore runs only when the projection
 * matrix changed, when the canvas resized, or when the fade is still moving.
 * A still map with moving water pays nothing, which is the same rule the mask
 * already follows and for the same reason.
 *
 * `THREE` is a CDN global, same as everywhere else in `proto/`.
 *
 * Imports: nothing. This file owes its caller a texture and a resolution.
 */

/**
 * @returns {object} handle — `texture`, `ready`, `width`, `height`,
 *          `capture(renderer, gl, matrix, fade)`, `status()`, `dispose()`.
 */
export function createSceneCopy() {
  /** ==> NOTHING GPU-SHAPED IS BUILT UNTIL THERE IS A GPU. <== Created on the
   *  first frame that actually wants a capture, so a map that never descends to
   *  a seamount never allocates a screen-sized texture, and the headless tests
   *  can construct this whole stack without touching `THREE`.
   *
   *  `null` data means WebGL allocates storage without an upload, so no pixel
   *  array is ever built on the CPU. LINEAR filtering here, unlike the mask's
   *  NEAREST: this texture is sampled at a deliberately offset coordinate and
   *  the whole point is a smooth displacement, where the mask's whole point was
   *  never inventing a colour halfway between sea and land. */
  let texture = null;
  let origin = null;

  let width = 1;
  let height = 1;
  let captured = false;
  let failed = false;
  let haveMatrix = false;
  let lastFade = -1;
  const lastMatrix = new Float64Array(16);

  function ensureTexture() {
    if (texture) return;
    texture = new THREE.DataTexture(null, 1, 1, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = false;
    origin = new THREE.Vector2(0, 0);
  }

  return {
    get texture() {
      return texture;
    },
    get ready() {
      return captured && !failed;
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },

    /**
     * Photograph the framebuffer, if this frame's picture differs from the last
     * one photographed.
     *
     * ==> CALL THIS BETWEEN THE TERRAIN RENDER AND THE WATER RENDER, AND
     * NOWHERE ELSE. <== Before the terrain and the mountains are missing from
     * the refraction; after the water and the sea refracts itself, which
     * feeds a surface its own previous frame and smears.
     *
     * @param {object} renderer THREE `WebGLRenderer` on MapLibre's context
     * @param {WebGLRenderingContext} gl
     * @param {Float32Array|number[]} matrix this frame's projection matrix
     * @param {number} fade the layer's zoom fade, 0..1
     * @returns {boolean} whether a copy was taken this frame
     */
    capture(renderer, gl, matrix, fade) {
      if (failed || !renderer) return false;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      if (w < 1 || h < 1) return false;

      ensureTexture();

      let must = false;
      if (texture.image.width !== w || texture.image.height !== h) {
        texture.image.width = w;
        texture.image.height = h;
        texture.needsUpdate = true;
        width = w;
        height = h;
        captured = false;
        must = true;
      }

      /* Sixteen floats compared rather than a listener on move, because this
       * catches everything that can change the picture in one test — pan, zoom,
       * rotate, pitch, a `flyTo` mid-flight, and a resize that changed the
       * projection without changing the canvas. */
      if (matrix && matrix.length === 16) {
        if (!haveMatrix) {
          must = true;
          haveMatrix = true;
        } else {
          for (let i = 0; i < 16; i++) {
            if (lastMatrix[i] !== matrix[i]) {
              must = true;
              break;
            }
          }
        }
        if (must) for (let i = 0; i < 16; i++) lastMatrix[i] = matrix[i];
      } else {
        must = true;
      }

      /* ==> THE FADE IS PART OF THE PICTURE, AND THE MATRIX DOES NOT CARRY IT.
       * <== The mountains dissolve in across `map3d.handoff`, and a zoom that
       * moves the fade always moves the matrix too — EXCEPT at the two ends of
       * a `flyTo` easing, where the matrix can settle a frame before the fade
       * does. One stale frame of a half-drawn mountain inside the refraction is
       * not worth reasoning about; comparing one float is cheaper than being
       * right about the easing. */
      if (fade !== lastFade) {
        must = true;
        lastFade = fade;
      }

      if (!captured) must = true;
      if (!must) return false;

      try {
        /* THREE's cached GL state and MapLibre's have nothing to do with one
         * another. Not reset here: the caller has just finished a
         * `renderer.render()`, so THREE's cache is accurate and a reset would
         * throw away exactly the state the next render is about to want. */
        renderer.copyFramebufferToTexture(origin, texture);
        captured = true;
        return true;
      } catch (e) {
        failed = true;
        console.error(
          'scene-copy: could not copy the scene out of the framebuffer — the sea ' +
            'will draw without refraction:',
          e
        );
        return false;
      }
    },

    /** One word for the prototype's stats bar. `-` is "no copy yet", which on
     *  the first frames is correct rather than broken. */
    status() {
      if (failed) return 'ref!';
      if (!captured) return 'ref-';
      return 'ref';
    },

    dispose() {
      if (texture) texture.dispose();
      texture = null;
      origin = null;
      captured = false;
      haveMatrix = false;
      lastFade = -1;
    },
  };
}
