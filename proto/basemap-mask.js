/**
 * basemap-mask.js — A COPY OF WHAT MAPLIBRE ALREADY DREW, SO THE SEA KNOWS
 * WHERE THE SHORE IS.
 *
 * PROTOTYPE CODE. Used only by `proto/volcano-3d.js`.
 *
 * ==> THE ONE IDEA. <== A seamount's sea sheet is a flat plane painted over the
 * basemap, and it has no notion of a coastline, so near Vanuatu it runs across
 * the islands. Three attempts to cut it went back to the vector TILE DATA and
 * rebuilt a coastline from it. All three failed, and they failed differently
 * each time — winding, tile-buffer overlap, tiles evicted from the cache — which
 * is the signature of asking a source a question it was not built to answer.
 *
 * The answer was already on screen. MapLibre draws the ocean every frame: every
 * tile stitched, every island, at exact screen resolution, correct through
 * rotation and pitch. This file copies that picture into a texture. The water
 * shader then asks one question per pixel — *is the thing underneath me the
 * ocean's colour or the land's?* — and draws only where the answer is ocean.
 *
 * Everything that bit the three previous attempts stops existing: no ring
 * winding, no polarity, no tile buffers, no antimeridian, no loaded-versus-
 * evicted, no `getBounds`. There is no geometry in this file at all.
 *
 * ---------------------------------------------------------------------------
 * ==> WHY IT IS ITS OWN MAPLIBRE LAYER, AND THIS IS THE LOAD-BEARING PART.
 *
 * The volcano layer sits on TOP of the whole style, so by the time it runs the
 * framebuffer holds coastline glow, plate seams, borders and place names as
 * well as the sea. A plate seam is orange; run the colour test against that and
 * the sea gets a hole punched through it wherever a seam crosses — and arc
 * seamounts sit ON plate seams, so that is the common case, not the corner one.
 *
 * So the copy is a SEPARATE, EMPTY custom layer placed low in the style: after
 * the ocean fill, before the first line or symbol layer. At that point the
 * picture is two colours and nothing else.
 *
 * ==> THE ORDERING IS GUARANTEED BY MAPLIBRE'S PASS STRUCTURE, NOT BY LUCK.
 * <== Read out of the v5.6.0 bundle: the painter runs `offscreen`, then
 * `opaque` walking layers in REVERSE order, then `translucent` walking them
 * FORWARD. An opaque fill (the ocean, `fill-opacity` 1) is drawn in the opaque
 * pass, which finishes entirely before the translucent pass starts. Lines and
 * symbols are translucent-only and are drawn at their own index. A custom layer
 * is translucent-pass at its index. So wherever the fills land, they are down
 * before this layer runs, and everything above it is not — for any style, on
 * either tile schema.
 *
 * ==> AND MAPLIBRE REPAIRS ITS OWN GL STATE AFTER EVERY CUSTOM LAYER. <== Same
 * bundle: `render()` is followed by `context.setDirty()`, `setBaseState()` and
 * a framebuffer rebind. So this file is free to hand the context to THREE and
 * leave it dirty, exactly as `proto/volcano-3d.js` already does.
 *
 * ---------------------------------------------------------------------------
 * ==> THE COPY IS SKIPPED WHENEVER IT WOULD PRODUCE THE SAME ANSWER. <== It is
 * a full-screen GPU blit, and the sea animates, so a naive version pays it on
 * every one of the frames the wave already forces. But MapLibre repaints the
 * identical basemap when the camera has not moved — so a mask taken last frame
 * is not stale, it is the same picture. The copy therefore runs only when the
 * projection matrix changed, when the canvas resized, or when tiles were still
 * arriving at the last capture. A still map with moving water pays nothing.
 *
 * And it does not run at all unless the sea is actually on screen and asking:
 * `setActive(false)` is the resting state and the layer returns immediately.
 *
 * `THREE` is a CDN global, same as everywhere else in `proto/`.
 *
 * Imports: nothing. This file owes its caller a texture and a resolution.
 */

const LAYER_ID = 'basemap-mask';

/** Fallback pair, used only if the style carries no `metadata` — which would
 *  mean a style this app did not build. Dark-theme ocean and high-zoom land, so
 *  the mask is wrong rather than absent, and `status()` says `meta!` so the
 *  reason is on screen rather than in the source. */
const FALLBACK_SEA = '#070D18';
const FALLBACK_LAND = '#1A2C42';

/** Unit RGB from a `#rrggbb`, matching the framebuffer's own sRGB bytes
 *  directly. Deliberately NOT `THREE.Color`, which carries colour-space
 *  conversion this comparison must not have — the pixels being compared came
 *  straight out of the canvas. */
function hexToUnitRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return null;
  const v = [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
  return v.some(Number.isNaN) ? null : v;
}

/**
 * Attach the shore mask to a MapLibre map.
 *
 * @param {object} map a MapLibre `Map`
 * @param {function} getRenderer returns the THREE `WebGLRenderer` sharing
 *        MapLibre's context, or null before `proto/volcano-3d.js` has started
 *        one. A getter rather than the renderer itself because this layer is
 *        added lower in the style and therefore possibly earlier.
 * @returns {object} handle
 */
export function createBasemapMask(map, getRenderer) {
  /** ==> NOTHING GPU-SHAPED IS BUILT UNTIL THERE IS A GPU. <== Created inside
   *  `render()`, on the first frame that actually wants a capture, rather than
   *  here. Two reasons and both are real: a map that never descends to a
   *  seamount should never allocate a screen-sized texture at all, and
   *  `tools/test-volcano-map3d.mjs` constructs this whole layer stack headless
   *  with a stub map to prove it survives an unloaded style — touching `THREE`
   *  at construction time makes that impossible to check without a browser.
   *
   *  `null` data means WebGL allocates storage without an upload, so no pixel
   *  array is ever built on the CPU — the first `copyTexImage2D` reallocates it
   *  to the framebuffer's size anyway. Nearest filtering because the sample is
   *  exactly one texel to one fragment; any interpolation here would invent
   *  colours halfway between sea and land and feed them straight into a test
   *  whose whole job is telling those two apart. */
  let texture = null;
  let origin = null;

  function ensureTexture() {
    if (texture) return;
    texture = new THREE.DataTexture(null, 1, 1, THREE.RGBAFormat);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = false;
    origin = new THREE.Vector2(0, 0);
  }

  /** The captured size, in framebuffer pixels. Plain numbers: the shader needs
   *  them as a vec2, but the vector belongs to the material that reads it. */
  let width = 1;
  let height = 1;

  let sea = hexToUnitRgb(FALLBACK_SEA);
  let land = hexToUnitRgb(FALLBACK_LAND);
  let readMetadata = false;

  let active = false;
  let captured = false;
  let capturedTilesLoaded = false;
  let failed = false;
  let added = false;
  let styleReady = false;
  const lastMatrix = new Float64Array(16);
  let haveMatrix = false;

  /** Read the sea/land pair off the live style. `map/style.js` publishes them
   *  in `metadata` precisely so this cannot drift from the colours the basemap
   *  was painted with — including after a world switch, which replaces the
   *  whole style and would otherwise leave this holding the previous world's
   *  palette. One `getStyle()` per style load, never per frame. */
  function readPalette() {
    readMetadata = false;
    let meta = null;
    try {
      meta = map.getStyle().metadata;
    } catch (e) {
      meta = null;
    }
    const s = meta && hexToUnitRgb(meta['landfall:seaColor']);
    const l = meta && hexToUnitRgb(meta['landfall:landColor']);
    if (s && l) {
      sea = s;
      land = l;
      readMetadata = true;
      return;
    }
    sea = hexToUnitRgb(FALLBACK_SEA);
    land = hexToUnitRgb(FALLBACK_LAND);
    console.warn(
      'basemap-mask: the style carries no landfall:seaColor/landColor — the shore ' +
        'will be cut against the default dark palette and may be wrong.'
    );
  }

  /**
   * ==> WHERE IN THE STACK THE COPY GOES, WORKED OUT FROM THE LIVE STYLE
   * RATHER THAN FROM A LAYER NAME. <== It must sit after the fills and before
   * the first line or symbol, and every style this app builds has exactly that
   * shape: a background, the ocean, inland water, then borders, seams, coast
   * and names. Finding the boundary by TYPE rather than by id means a renamed
   * or reordered coastline cannot silently move the capture point — and it
   * works unchanged on the Protomaps schema, where the fills are a different
   * set of layers entirely.
   */
  function beforeId() {
    let layers = null;
    try {
      layers = map.getStyle().layers;
    } catch (e) {
      return undefined;
    }
    if (!layers) return undefined;
    for (const l of layers) {
      if (l.type === 'line' || l.type === 'symbol') return l.id;
    }
    return undefined;
  }

  const layer = {
    id: LAYER_ID,
    type: 'custom',
    /** 2d, NOT 3d. A `3d` custom layer sets MapLibre's `opaquePassCutoff` to
     *  its own index, which would push every fill below it out of the opaque
     *  pass — including the ocean fill this layer exists to photograph. */
    renderingMode: '2d',

    onAdd() {},

    render(gl, args) {
      if (!active || failed) return;
      const renderer = getRenderer && getRenderer();
      if (!renderer) return;

      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      if (w < 1 || h < 1) return;

      ensureTexture();

      /* A resize means a new allocation, so the texture is marked for upload
       * and the old capture is not comparable to the new one. */
      let mustCapture = false;
      if (texture.image.width !== w || texture.image.height !== h) {
        texture.image.width = w;
        texture.image.height = h;
        texture.needsUpdate = true;
        width = w;
        height = h;
        captured = false;
        mustCapture = true;
      }

      /* The camera. Sixteen floats compared rather than a listener on move,
       * because this catches everything that can change the picture in one
       * test — pan, zoom, rotate, pitch, a `flyTo` mid-flight, and a resize
       * that changed the projection without changing the canvas. */
      const m = args && args.defaultProjectionData
        ? args.defaultProjectionData.fallbackMatrix || args.defaultProjectionData.mainMatrix
        : args;
      if (m && m.length === 16) {
        if (!haveMatrix) {
          mustCapture = true;
          haveMatrix = true;
        } else {
          for (let i = 0; i < 16; i++) {
            if (lastMatrix[i] !== m[i]) {
              mustCapture = true;
              break;
            }
          }
        }
        if (mustCapture) for (let i = 0; i < 16; i++) lastMatrix[i] = m[i];
      } else {
        mustCapture = true;
      }

      /* ==> A CAPTURE TAKEN WHILE TILES WERE STILL ARRIVING IS NOT FINAL. <==
       * On the OpenMapTiles schema an unpainted tile shows the background,
       * which IS the land colour, so a half-loaded ocean reads as land and the
       * sea would be cut away from it. That is the same shape of mistake that
       * killed attempt three — but here it self-corrects, because this asks
       * again on the next frame until the tiles are down. */
      if (!captured || !capturedTilesLoaded) mustCapture = true;
      if (!mustCapture) return;

      try {
        /* THREE's cached GL state and MapLibre's have nothing to do with one
         * another; without this the bind can be skipped as a no-op against a
         * cache describing a context MapLibre has since changed. */
        renderer.resetState();
        renderer.copyFramebufferToTexture(origin, texture);
        captured = true;
        capturedTilesLoaded = typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
      } catch (e) {
        failed = true;
        console.error(
          'basemap-mask: could not copy the basemap out of the framebuffer — the sea ' +
            'will draw without a shoreline cut:',
          e
        );
      }
    },
  };

  function add() {
    if (added || !styleReady) return;
    map.addLayer(layer, beforeId());
    added = true;
  }

  map.on('style.load', () => {
    styleReady = true;
    readPalette();
    /* A new style is a new picture and possibly a new palette. */
    captured = false;
    haveMatrix = false;
    if (map.getLayer(LAYER_ID)) return;
    added = false;
    add();
  });

  return {
    /** The photograph, or null before the first frame that wanted one. The
     *  caller re-reads it each frame rather than caching it, so the lazy build
     *  reaches the shader with nothing to wire up. */
    get texture() {
      return texture;
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    /** Unit RGB, live. Read every frame by the caller rather than copied, so a
     *  world switch reaches the shader without a second wiring step. */
    get sea() {
      return sea;
    },
    get land() {
      return land;
    },
    /** Is there a usable photograph of the basemap right now? The shader draws
     *  the sea UNCUT while this is false — one frame of the old behaviour on
     *  the very first frame is invisible, and hiding the water instead would
     *  turn a missing mask into a missing sea. */
    get ready() {
      return captured && !failed;
    },

    /** Told by the caller whether any sea is on screen. The copy is a
     *  full-screen blit; nothing else in this app should pay for it while
     *  there is no water to cut. */
    setActive(on) {
      active = !!on;
    },

    /** One word for the stats bar, distinct per failure (SPEC.md §5).
     *   `off`    no sea on screen, so nothing is being captured — correct
     *   `m!`     the copy threw; the sea is drawing with no shoreline cut
     *   `m?`     active but nothing captured yet (first frame, or resizing)
     *   `meta!`  capturing, but against fallback colours because the style
     *            published none — the cut may be in the wrong place
     *   `m`      working */
    status() {
      if (failed) return 'm!';
      if (!active) return 'off';
      if (!captured) return 'm?';
      if (!readMetadata) return 'meta!';
      return 'm';
    },

    dispose() {
      if (added && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      added = false;
      if (texture) texture.dispose();
      texture = null;
      origin = null;
    },
  };
}
