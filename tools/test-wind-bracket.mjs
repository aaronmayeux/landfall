/**
 * test-wind-bracket.mjs — the GDACS current-wind bracket (lib/wind-bracket.js).
 *
 * The fixtures mirror spec-parameter §28.2's validated table: a centre inside
 * all three bands (Fausto), inside the slowest only (Genevieve), outside all
 * of them (Bertha), plus the failure modes the module promises to refuse —
 * non-nested geometry and unusable input. Antimeridian and hole handling get
 * their own cases because those are the two ways ray casting silently lies.
 *
 * Plain node, no dependencies, discovered by the CI glob.
 */

import { windBracketFromBands, geometryContains } from '../lib/wind-bracket.js';

let passed = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (cond, msg) => {
  if (!cond) fail(msg);
  passed++;
};

/* --- fixture helpers ------------------------------------------------------ */

/** A square band centred on (lon, lat) with half-width `r` degrees, tagged
 *  the way data/gdacs-geometry.js tags a parsed band. */
function band(colorKey, lon, lat, r) {
  return {
    type: 'Feature',
    properties: { radii: colorKey, _gdacsKmh: { 34: 60, 50: 90, 64: 120 }[colorKey] },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lon - r, lat - r], [lon + r, lat - r],
        [lon + r, lat + r], [lon - r, lat + r],
        [lon - r, lat - r],
      ]],
    },
  };
}

/* --- the §28.2 table ------------------------------------------------------ */

{ // inside 60/90/120 → at least 65 kt, no ceiling (Fausto, Noul)
  const bands = [band(34, 130, 20, 3), band(50, 130, 20, 2), band(64, 130, 20, 1)];
  const b = windBracketFromBands(bands, 130, 20);
  ok(b && b.minKt === 65 && b.maxKt === null, `all-in → ≥65 kt, got ${JSON.stringify(b)}`);
}

{ // inside 60 only → 32–49 kt (Genevieve)
  const bands = [band(34, 130, 20, 3), band(50, 133.5, 20, 1), band(64, 133.5, 20, 0.5)];
  const b = windBracketFromBands(bands, 130, 20);
  ok(b && b.minKt === 32 && b.maxKt === 49, `green-only → 32–49 kt, got ${JSON.stringify(b)}`);
}

{ // inside 60 and 90, outside 120 → 49–65 kt
  const bands = [band(34, 130, 20, 3), band(50, 130, 20, 2), band(64, 134, 20, 0.5)];
  const b = windBracketFromBands(bands, 130, 20);
  ok(b && b.minKt === 49 && b.maxKt === 65, `orange → 49–65 kt, got ${JSON.stringify(b)}`);
}

{ // outside everything → under 32 kt (Bertha)
  const bands = [band(34, 140, 20, 1)];
  const b = windBracketFromBands(bands, 130, 20);
  ok(b && b.minKt === null && b.maxKt === 32, `all-out → <32 kt, got ${JSON.stringify(b)}`);
}

{ // a weak storm publishing ONLY a green band, centre inside → 32–49 kt:
  // the missing 90 band is GDACS saying the storm reaches 90 nowhere, so the
  // ceiling is a claim the source itself made.
  const b = windBracketFromBands([band(34, 130, 20, 3)], 130, 20);
  ok(b && b.minKt === 32 && b.maxKt === 49, `green-only publish → 32–49 kt, got ${JSON.stringify(b)}`);
}

/* --- refusals ------------------------------------------------------------- */

{ // non-nested: inside Red but outside Green — broken geometry, no claim
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  const bands = [band(34, 140, 20, 1), band(64, 130, 20, 1)];
  const b = windBracketFromBands(bands, 130, 20);
  console.warn = warn;
  ok(b === null, `non-nested must refuse, got ${JSON.stringify(b)}`);
  ok(warned === 1, 'non-nested refusal must be stated in the console (§5)');
}

{ // unusable input → null, never a throw and never a guess
  ok(windBracketFromBands(null, 130, 20) === null, 'null features → null');
  ok(windBracketFromBands([], 130, 20) === null, 'empty features → null');
  ok(windBracketFromBands([band(34, 130, 20, 3)], NaN, 20) === null, 'NaN lon → null');
  ok(
    windBracketFromBands([{ properties: { radii: 999 }, geometry: null }], 130, 20) === null,
    'no recognisable band → null'
  );
}

/* --- geometry edge cases -------------------------------------------------- */

{ // antimeridian: a band from 178 to -178 (crossing the seam), point at 179.5
  const g = {
    type: 'Polygon',
    coordinates: [[[178, 18], [-178, 18], [-178, 22], [178, 22], [178, 18]]],
  };
  ok(geometryContains(g, 179.5, 20), 'antimeridian ring contains a point past the seam');
  ok(geometryContains(g, -179.5, 20), 'antimeridian ring contains a point on the west side');
  ok(!geometryContains(g, 170, 20), 'antimeridian ring excludes a point outside it');
  const f = { properties: { radii: 34 }, geometry: g };
  const b = windBracketFromBands([f], 179.5, 20);
  ok(b && b.minKt === 32, `antimeridian bracket holds, got ${JSON.stringify(b)}`);
}

{ // a hole: outer 10°, hole 2°, point in the hole is OUTSIDE (even-odd)
  const g = {
    type: 'Polygon',
    coordinates: [
      [[120, 10], [140, 10], [140, 30], [120, 30], [120, 10]],
      [[129, 19], [131, 19], [131, 21], [129, 21], [129, 19]],
    ],
  };
  ok(!geometryContains(g, 130, 20), 'point inside a hole is outside');
  ok(geometryContains(g, 125, 20), 'point in the annulus is inside');
}

{ // MultiPolygon: inside the second part counts
  const g = {
    type: 'MultiPolygon',
    coordinates: [
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      [[[120, 10], [140, 10], [140, 30], [120, 30], [120, 10]]],
    ],
  };
  ok(geometryContains(g, 130, 20), 'MultiPolygon second part contains');
  ok(!geometryContains(g, 60, 20), 'MultiPolygon gap does not');
}

console.log(`✓ ${passed} assertions passed`);
