/**
 * fog-fade.js — MAKE DISTANCE FOG FADE THINGS OUT, NOT JUST RECOLOUR THEM.
 *
 * ==> THE PROBLEM THIS EXISTS TO FIX. <==
 *
 * The clear globe (map/globe3d.js) is see-through by design, so the far half of
 * the cage, the far continents and the far coastlines all draw across the near
 * half. Three.js distance fog is what keeps that from being a mess: it blends a
 * fragment toward `space` by depth, so the back of the globe recedes.
 *
 * Fog only touches COLOUR. It never touches alpha. In the DARK theme that is
 * invisible as a limitation, because `space` (#04070E) is within a few levels
 * of the backdrop sitting behind the globe (`spaceNear`, #0F1F38) — a fully
 * fogged line lands on the backdrop's own value and disappears. Fog appears to
 * fade things out. It does not; it just happens to arrive at the right colour.
 *
 * The LIGHT theme has no such luck. `space` is #C2C6CA, pinned to the OCEAN's
 * value on purpose (see the token note), while the backdrop directly behind the
 * globe at the planet band is the pale bloom `spaceNear` at #EFF7FF. Those two
 * disagree by about 30 levels, and every far-side fragment lands on that gap.
 * Measured on the cage: the far lattice sits 44 levels off the backdrop in
 * light against 8 in dark. Aaron's report was "we can see too clearly through
 * the globe", and that number is what he was looking at.
 *
 * ==> WHY THE OBVIOUS FIX IS NOT AVAILABLE. <==
 *
 * The literal answer — a translucent shell inside the sphere, smoke in a glass
 * ball — has to be drawn AFTER the far-side geometry and BEFORE the near-side
 * geometry. It cannot be. The cage, the nodes, the coastlines and the storm-lit
 * fill are each ONE draw call spanning both hemispheres; only the land is split
 * front/back. There is no gap to put a shell into, and splitting four surfaces
 * by hemisphere every frame is per-frame CPU work on a phone. Rejected.
 *
 * ==> AND WHY RECOLOURING IS THE WRONG LEVER EVEN WHEN IT WORKS. <==
 *
 * Pointing the light theme's fog at the bloom instead of the ocean would hide
 * the far side at the planet band — and break the moment MapLibre fades up
 * underneath, because MapLibre's daylight ocean IS #C2C6CA. The correct fog
 * colour would change with zoom. Alpha does not care what is behind it, which
 * is the whole reason this file fades alpha instead.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 * Eight lines of GLSL appended to Three's own fog block: reuse the `fogFactor`
 * it already computed, remap it so nothing happens until the limb, and multiply
 * alpha down across the back half.
 *
 *   near pole  fogFactor 0.008  ->  haze 0     untouched
 *   limb       fogFactor 0.357  ->  haze 0     untouched
 *   far pole   fogFactor 0.849  ->  haze 1     faded by the full amount
 *
 * The near shell stays crisp glass; the inside of the sphere hazes over. That
 * remap is why the near limb does not go translucent — which matters, because
 * in the light theme the coastline is the only thing holding the continents
 * apart from the bloom (see the `spaceFar` note in config/tokens.js).
 *
 * `DIVE.fogFadeStart` is that limb value, DERIVED from the same two numbers the
 * fog band itself is built from rather than hand-set beside them.
 *
 * ---------------------------------------------------------------------------
 * THREE.JS MECHANICS, THE PARTS THAT ARE EASY TO GET WRONG
 *
 * - `onBeforeCompile` receives the shader with its `#include` directives still
 *   UNRESOLVED (verified against the vendored r128 build: the renderer calls
 *   `onBeforeCompile(parameters)` before `acquireProgram`). So the string to
 *   replace is `#include <fog_fragment>`, never the resolved `gl_FragColor.rgb
 *   = mix(...)` line — that text is not there yet.
 *
 * - THE STRENGTH IS A UNIFORM, NOT A BAKED-IN LITERAL, AND THAT IS LOAD-BEARING.
 *   Three caches compiled programs globally under a key that includes
 *   `onBeforeCompile.toString()` — which does not capture a closure variable.
 *   Baking the number into the shader text would let a light-theme material
 *   collect a dark-theme program out of that cache and silently render the
 *   wrong strength. A uniform sidesteps it: every patched material produces
 *   byte-identical shader text and correctly SHARES one program, while each
 *   keeps its own uniform.
 *
 * - Three r128 names the fog varying `fogDepth` (later revisions renamed it
 *   `vFogDepth`). This file never touches it, but tools/test-fog-fade.mjs
 *   pins the chunk text against the vendored build so a Three upgrade that
 *   moves this ground fails loudly instead of quietly doing nothing.
 *
 * Imports config/ only. No THREE reference of its own — it patches whatever
 * material it is handed.
 */

import { DIVE } from '../config/constants.js';

/** The exact directive we hook. Exported so the test can assert the vendored
 *  Three build still emits it — if it ever stops, the patch becomes a silent
 *  no-op and the far side quietly comes back. */
export const FOG_INCLUDE = '#include <fog_fragment>';

/** Where the uniform declarations go in. Same reasoning as above. */
export const FOG_PARS_INCLUDE = '#include <fog_pars_fragment>';

/** The GLSL appended after Three's own fog blend. Exported for the test. */
export const FOG_FADE_GLSL = `
	float landfallHaze = smoothstep( landfallFadeStart, 1.0, fogFactor );
	gl_FragColor.a *= 1.0 - landfallHaze * landfallFadeAmount;
`;

/** The uniform declarations. Prefixed so nothing can collide with a Three
 *  built-in now or after an upgrade. */
export const FOG_FADE_PARS = `
uniform float landfallFadeAmount;
uniform float landfallFadeStart;
`;

/**
 * Teach one material to fade out with distance instead of only recolouring.
 *
 * @param {object} material - any fogged Three material (Basic, Line, Points)
 * @param {number} amount   - 0 = today's behaviour exactly, 1 = the far pole
 *                            goes fully transparent. Comes from `fx().fogFade`.
 * @returns {{ set(amount: number): void }} handle for the theme switch
 */
export function attachFogFade(material, amount = 0) {
  /* ONE uniform object per material, held in this closure. The theme switch
   * mutates `.value` in place, so it does not matter whether Three re-runs
   * onBeforeCompile or serves the material its cached program — both paths end
   * up pointing at this same object. */
  const uniforms = {
    landfallFadeAmount: { value: amount },
    landfallFadeStart: { value: DIVE.fogFadeStart },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.landfallFadeAmount = uniforms.landfallFadeAmount;
    shader.uniforms.landfallFadeStart = uniforms.landfallFadeStart;
    shader.fragmentShader = shader.fragmentShader
      .replace(FOG_PARS_INCLUDE, FOG_PARS_INCLUDE + FOG_FADE_PARS)
      .replace(FOG_INCLUDE, FOG_INCLUDE + FOG_FADE_GLSL);
  };
  material.needsUpdate = true;

  return {
    set(next) {
      uniforms.landfallFadeAmount.value = next;
      /* Belt and braces on a rare event. Mutating the uniform is enough on the
       * ordinary path, but `needsUpdate` guarantees the renderer re-reads it on
       * the very next frame rather than on whatever frame it would otherwise
       * decide to refresh material uniforms. A theme toggle costs at most one
       * shader lookup; a frame of the wrong haze is visible. */
      material.needsUpdate = true;
    },
  };
}
