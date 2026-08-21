#!/usr/bin/env node
/**
 * test-fog-fade.mjs — the interior haze on the clear globe (map/fog-fade.js).
 *
 * ==> WHAT THIS IS REALLY GUARDING. <== The patch works by string-replacing two
 * `#include` directives inside Three.js's own fragment shader. If Three ever
 * stops emitting either one — a version bump, a chunk rename, a minifier that
 * rewrites the source — `String.replace` finds nothing, returns the string
 * unchanged, and throws NOTHING. The shader compiles. The globe renders. The
 * far hemisphere quietly comes back and nobody finds out until Aaron looks at
 * it in daylight. A silent no-op is the whole failure mode here, so most of
 * this file is aimed at it.
 *
 * SIX CHECKS
 *   1. The vendored Three build still emits both `#include` directives.
 *   2. It still names the things our GLSL reads (`fogFactor`, `gl_FragColor`).
 *   3. The patch actually changes the shader — both halves land.
 *   4. The strength is a uniform, and the theme switch moves it.
 *   5. `DIVE.fogFadeStart` really is the limb, derived from the fog band.
 *   6. Both palettes carry a legal `fogFade`, and light is the one that needs it.
 *
 * Zero dependencies. `node tools/test-fog-fade.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { DIVE } from '../config/constants.js';
import { DARK, LIGHT } from '../config/tokens.js';
import {
  attachFogFade,
  FOG_INCLUDE,
  FOG_PARS_INCLUDE,
  FOG_FADE_GLSL,
  FOG_FADE_PARS,
} from '../map/fog-fade.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const THREE_SRC = fs.readFileSync(
  path.join(ROOT, 'vendor/three-0.128.0.min.js'),
  'utf8',
);

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const is = (actual, expected, m) =>
  (actual === expected ? ok(m) : fail(`${m} — got ${actual}, wanted ${expected}`));
const yes = (cond, m) => (cond ? ok(m) : fail(m));

const near = (a, b, tol, m) =>
  (Math.abs(a - b) <= tol ? ok(`${m} (${a.toFixed(4)})`)
    : fail(`${m} — got ${a}, wanted ${b} +/- ${tol}`));

console.log('\nfog fade — the haze inside the clear globe\n');

/* ---------------------------------------------------------------- 1 + 2 ---
 * The ground the patch stands on. These read the SHIPPED vendor file, not a
 * fixture, because the fixture would just inherit whatever assumption the
 * patch was written against. */

yes(
  THREE_SRC.includes(FOG_INCLUDE),
  `vendored Three still emits ${FOG_INCLUDE}`,
);
yes(
  THREE_SRC.includes(FOG_PARS_INCLUDE),
  `vendored Three still emits ${FOG_PARS_INCLUDE}`,
);

/* The fog chunk itself has to still declare `fogFactor` and write through
 * `gl_FragColor` — our GLSL reads the first and multiplies the second. r128
 * spells the varying `fogDepth`; later revisions renamed it `vFogDepth`, which
 * is the kind of move that lands here. */
yes(
  /float\s+fogFactor\s*=\s*smoothstep\(\s*fogNear\s*,\s*fogFar\s*,/.test(THREE_SRC),
  'the fog chunk still computes `fogFactor` as a smoothstep across the band',
);
yes(
  THREE_SRC.includes('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );'),
  'the fog chunk still blends through `gl_FragColor` (so alpha is ours to take)',
);

/* --------------------------------------------------------------------- 3 ---
 * The patch lands. A fake material stands in for a Three material: all
 * attachFogFade touches is `onBeforeCompile` and `needsUpdate`. */

const fakeMaterial = () => ({ onBeforeCompile: null, needsUpdate: false });

/* A stand-in for the shader object the renderer hands over — includes still
 * unresolved, which is the state verified against the vendored build (the
 * renderer calls onBeforeCompile before acquireProgram). */
const fakeShader = () => ({
  uniforms: {},
  fragmentShader: [
    'void main() {',
    '\tgl_FragColor = vec4( 1.0 );',
    `\t${FOG_PARS_INCLUDE}`,
    `\t${FOG_INCLUDE}`,
    '}',
  ].join('\n'),
});

{
  const m = fakeMaterial();
  attachFogFade(m, 0.9);
  yes(typeof m.onBeforeCompile === 'function', 'attachFogFade installs onBeforeCompile');

  const s = fakeShader();
  m.onBeforeCompile(s);

  yes(
    s.fragmentShader.includes(FOG_FADE_GLSL.trim().split('\n')[0].trim()),
    'the alpha fade lands in the fragment shader',
  );
  yes(
    s.fragmentShader.includes('uniform float landfallFadeAmount;'),
    'the uniform declarations land in the fragment shader',
  );
  yes(
    s.fragmentShader.indexOf('uniform float landfallFadeAmount;')
      < s.fragmentShader.indexOf('landfallHaze'),
    'the declarations come BEFORE the code that reads them',
  );
  /* Three's own line must survive — we append to fog, never replace it. Losing
   * the recolour while keeping the fade would fix the light theme by breaking
   * the dark one. */
  yes(
    s.fragmentShader.includes(FOG_INCLUDE),
    "Three's own fog blend is still in the shader (we append, never replace)",
  );
}

/* --------------------------------------------------------------------- 4 ---
 * The strength is a live uniform, not text. If it were baked into the shader
 * source, Three's global program cache — keyed on onBeforeCompile.toString(),
 * which cannot see a closure variable — would hand a light-theme material a
 * dark-theme program. */

{
  const m = fakeMaterial();
  const handle = attachFogFade(m, 0.0);
  const s = fakeShader();
  m.onBeforeCompile(s);

  is(s.uniforms.landfallFadeAmount.value, 0.0, 'strength starts where it was set');
  handle.set(0.9);
  is(s.uniforms.landfallFadeAmount.value, 0.9, 'a theme switch moves the live uniform');

  /* ==> THE MULTIPLY MUST NAME THE UNIFORM. <== The weaker version of this
   * check only looked for a number assigned to the uniform, and a mutation that
   * swapped the uniform for a literal AT THE POINT OF USE sailed straight past
   * it — the uniform still existed and still moved, it just no longer reached
   * the shader. Assert the expression itself. */
  yes(
    /landfallHaze\s*\*\s*landfallFadeAmount/.test(s.fragmentShader),
    'the fade multiplies by the UNIFORM, not by a baked-in number',
  );
  yes(
    !/landfallHaze\s*\*\s*[0-9]/.test(s.fragmentShader),
    'no numeric literal has been baked in beside it',
  );

  /* Two materials must produce byte-identical shader text so they correctly
   * SHARE one compiled program while keeping separate uniforms. */
  const a = fakeMaterial();
  const b = fakeMaterial();
  const ha = attachFogFade(a, 0.0);
  attachFogFade(b, 0.9);
  const sa = fakeShader();
  const sb = fakeShader();
  a.onBeforeCompile(sa);
  b.onBeforeCompile(sb);
  is(sa.fragmentShader, sb.fragmentShader,
    'two materials at different strengths emit identical shader text');
  yes(
    sa.uniforms.landfallFadeAmount !== sb.uniforms.landfallFadeAmount,
    'but each material owns its own uniform object',
  );
  ha.set(0.5);
  is(sb.uniforms.landfallFadeAmount.value, 0.9,
    "moving one material's strength does not move another's");
}

/* --------------------------------------------------------------------- 5 ---
 * fogFadeStart is the LIMB, and it is derived. Hand-setting it beside the fog
 * band is how the haze ends up starting in the wrong place after someone
 * retunes the band. */

{
  const span = DIVE.fogNearBack + DIVE.fogFarAhead;
  const smoothstep = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  /* Depth is measured from the camera; the globe's centre sits at `dist`, so
   * the limb's depth is exactly `dist` and its fog factor is this. */
  const limb = smoothstep(DIVE.fogNearBack / span);
  near(DIVE.fogFadeStart, limb, 1e-9, 'fogFadeStart is the fog factor at the limb');

  /* The three orientation values quoted in the constants note. If the band is
   * ever retuned these move, and the note has to move with them — that is the
   * point of asserting them. */
  near(smoothstep((DIVE.fogNearBack - 1) / span), 0.008, 5e-4, 'near pole fog factor');
  near(limb, 0.357, 5e-4, 'limb fog factor');
  near(smoothstep((DIVE.fogNearBack + 1) / span), 0.849, 5e-4, 'far pole fog factor');

  /* And the remap does what it claims at both ends: nothing at the limb, full
   * strength at the back of the globe. */
  const haze = (fogFactor) =>
    smoothstep((fogFactor - DIVE.fogFadeStart) / (1 - DIVE.fogFadeStart));
  near(haze(limb), 0, 1e-9, 'the near shell takes no haze at all');
  yes(haze(smoothstep((DIVE.fogNearBack + 1) / span)) > 0.8,
    'the far pole takes nearly the full haze');
}

/* --------------------------------------------------------------------- 6 ---
 * The theme numbers. */

for (const [name, p] of [['DARK', DARK], ['LIGHT', LIGHT]]) {
  yes(typeof p.fx.fogFade === 'number', `${name}.fx.fogFade is a number`);
  yes(p.fx.fogFade >= 0 && p.fx.fogFade <= 1, `${name}.fx.fogFade is within 0..1`);
}

/* ==> THE ASYMMETRY IS THE POINT, so assert the direction rather than the
 * values. Dark's fog colour already lands on its backdrop and needs no fade;
 * light's does not and needs almost all of one. Anyone who "tidies" these to
 * one shared number is undoing the fix. */
is(DARK.fx.fogFade, 0, 'dark asks for no haze — its fog colour already hides the far side');
yes(LIGHT.fx.fogFade > 0.5, 'light asks for most of the haze');

console.log(
  failures === 0
    ? '\nfog fade: all checks passed\n'
    : `\nfog fade: ${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
