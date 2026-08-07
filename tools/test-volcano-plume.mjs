/**
 * test-volcano-plume.mjs — the ash column, asserted without a browser.
 *
 * ==> THE ONE THAT MATTERS IS THE SUBTRACTION, AND IT IS THE ONE THAT WOULD
 * NEVER HAVE FAILED VISIBLY. <== A VAAC advisory states an altitude above sea
 * level. Read as a height above ground it draws Sabancaya's 441 m plume as a
 * 6.4 km column — which looks entirely convincing on a phone. Every check here
 * exists because the wrong answer is plausible.
 *
 *   node tools/test-volcano-plume.mjs
 */

import { readFileSync } from 'node:fs';
import { VOLCANO } from '../config/volcano.js';
import { volcanoFamily, isSubmarine } from '../lib/volcano-shape.js';
import { ridgeMember, clusterMembers, buildRidge, surfaceHeightAt } from '../lib/volcano-ridge.js';
import { isAshEruption, plumeHeight, buildPlumeColumns } from '../lib/volcano-plume.js';
import { parseStream, readSourceElev } from '../functions/api/volcano/_vaa.js';

const P = VOLCANO.map3d.plume;
const M3 = VOLCANO.map3d;
const FT = 0.3048;

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---------------------------------------------------- the elevation reader */

console.log('\nSOURCE ELEV / SUMMIT ELEV — the unit varies by centre');

check('metres with AMSL', readSourceElev('1229M AMSL') === 1229);
check('metres with no AMSL at all', readSourceElev('3357M') === 3357);
check(
  'feet with a space before the unit',
  near(readSourceElev('11686 FT AMSL'), 11686 * FT, 1e-6),
  String(readSourceElev('11686 FT AMSL'))
);
/* ==> BUENOS AIRES SAYS IT TWICE AND THE TWO MUST AGREE. <== `19576 FT
 * (5967 M)` is one elevation in two units. Whichever is taken, the answer has
 * to be the same mountain — a parser that grabbed the digits nearest the end
 * would be reading metres here and feet everywhere else. */
check(
  'feet and metres in one field resolve to the same mountain',
  near(readSourceElev('19576 FT (5967 M)'), 5967, 2),
  String(readSourceElev('19576 FT (5967 M)'))
);
check('UNKNOWN is null, never zero', readSourceElev('SUMMIT ELEV: UNKNOWN') === null);
check('an absent field is null', readSourceElev(undefined) === null);
/* Zero would put the volcano at sea level and make its plume as tall as the
 * whole flight level — the exact failure this parser exists to prevent. */
check('null is not falsy-collapsed to 0', readSourceElev('') !== 0);

/* ------------------------------------------- the elevation on live records */

console.log('\nthe captured bulletins carry it through the parser');

const fixture = (name) =>
  readFileSync(new URL('../samples/vaac/' + name, import.meta.url), 'utf8');

const darwin = parseStream(fixture('darwin-dukono-active.txt'), {
  exerciseStatus: VOLCANO.ash.exerciseStatus,
  flightLevelToFeet: VOLCANO.ash.flightLevelToFeet,
});
const dukono = darwin.advisories[0];
check('Dukono parses', !!dukono && dukono.n === 268010, dukono && String(dukono.n));
check('and states its elevation in metres', dukono.sourceElevM === 1229, String(dukono.sourceElevM));

const wash = parseStream(fixture('washington-reventador-active.txt'), {
  exerciseStatus: VOLCANO.ash.exerciseStatus,
  flightLevelToFeet: VOLCANO.ash.flightLevelToFeet,
});
const rev = wash.advisories[0];
check(
  'Reventador states its elevation in FEET and converts',
  near(rev.sourceElevM, 11686 * FT, 1e-6),
  String(rev.sourceElevM)
);

/* ==> THE WHOLE POINT, ON REAL BYTES. <== Reventador's advisory tops out at
 * 14,000 ft. The mountain is 3,562 m. The plume is ~705 m, not 4,267 m. */
const revPlume = plumeHeight({ ash: { ...rev, status: 'active' } }, null);
check(
  'and its column is 705 m, not the 4,267 m the flight level would give',
  revPlume.stated && near(revPlume.m, 14000 * FT - 11686 * FT, 1),
  revPlume && String(Math.round(revPlume.m))
);

/* -------------------------------------------------- what earns a column */

console.log('\nonly an active, non-resuspended ash advisory draws');

const ashOf = (over) => ({ ash: { status: 'active', plumeTopFeet: 20000, sourceElevM: 5000, ...over } });

check('an active advisory draws', plumeHeight(ashOf({})) !== null);
check('a closing advisory does not', plumeHeight(ashOf({ status: 'closing' })) === null);
check('a quiet advisory does not', plumeHeight(ashOf({ status: 'quiet' })) === null);
check('no ash channel at all does not', plumeHeight({ report: { erupting: true } }) === null);
/* Great Sitkin and Kilauea: erupting, lava, in no advisory anywhere. Smoke
 * over them is §42.1.5's outright lie. */
check('a lava-only eruption gets no smoke', plumeHeight({ report: { erupting: true, emissions: ['lava'] } }) === null);

console.log('\nresuspended ash is not an eruption');

const resusp = { ash: { status: 'active', plumeTopFeet: 21000, sourceElevM: 5960, resuspended: true } };
check('it draws no column', plumeHeight(resusp) === null);
/* ==> AND IT NO LONGER PUTS THE VOLCANO IN THE ERUPTING SET. <== Measured on
 * the live wire 2026-07-31: Sabancaya arrived named, numbered and active with
 * `NO ERUPTION - RESUSPENDED VA` in its own bulletin, and the globe drew it in
 * magma orange as an erupting volcano. */
check('and it is not an ash eruption', isAshEruption(resusp.live || resusp) === false);
check('a real advisory still is', isAshEruption({ ash: { status: 'active' } }) === true);
check('no advisory is not', isAshEruption({}) === false);

/* ----------------------------------------------------- the honesty rules */

console.log('\nheight published -> true altitude; height missing -> a refusal');

const noTop = plumeHeight({ ash: { status: 'active', plumeTopFeet: null, sourceElevM: 1000 } });
check('no published top gives the untopped puff', noTop.stated === false && noTop.m === P.unknownM);
/* ==> AND THE PUFF MUST BE SHORTER THAN THE SHORTEST REAL PLUME EVER
 * MEASURED. <== 441 m, Sabancaya. If the refusal could pass for a measurement
 * the rule is decorative. */
check('and it is shorter than the smallest measured plume (441 m)', P.unknownM < 441);

const noElev = plumeHeight({ ash: { status: 'active', plumeTopFeet: 20000, sourceElevM: null } }, null);
check(
  'a top with nothing to subtract also refuses, rather than using the flight level',
  noElev.stated === false && noElev.m === P.unknownM,
  String(noElev.m)
);

/* ==> THE CATALOG IS THE FALLBACK AND ONLY THE FALLBACK. <== */
const fellBack = plumeHeight({ ash: { status: 'active', plumeTopFeet: 20000, sourceElevM: null } }, 5000);
check('the catalog elevation is used when the bulletin has none', near(fellBack.m, 20000 * FT - 5000, 1));
const preferred = plumeHeight({ ash: { status: 'active', plumeTopFeet: 20000, sourceElevM: 4000 } }, 5000);
check("the centre's own elevation outranks the catalog", near(preferred.m, 20000 * FT - 4000, 1));
/* A volcano at sea level is a real thing and `||` would throw the zero away. */
check('a sea-level volcano is not treated as missing', plumeHeight({ ash: { status: 'active', plumeTopFeet: 10000, sourceElevM: 0 } }).m > 3000);

const inverted = plumeHeight({ ash: { status: 'active', plumeTopFeet: 5000, sourceElevM: 3000 } });
check('an inverted subtraction clamps rather than going negative', inverted.m === P.minM && inverted.clamped === true);
check('and it still counts as stated', inverted.stated === true);

/* --------------------------------------------------------- the geometry */

console.log('\nthe column geometry');

const catalog = JSON.parse(
  readFileSync(new URL('../assets/hazards/volcanoes-holocene.geojson', import.meta.url), 'utf8')
);

function markOf(f, plume) {
  const p = f.properties;
  const c = f.geometry.coordinates;
  return {
    n: p.n,
    name: p.name,
    elev: Number(p.elev),
    lon: c[0],
    lat: c[1],
    submarine: isSubmarine(p),
    family: volcanoFamily(p),
    erupting: !!plume,
    lava: false,
    plume: plume || null,
  };
}

/* Dukono itself, since its real numbers are the ones quoted throughout. */
const feature = catalog.features.find((f) => f.properties.n === 268010);
check('Dukono is in the catalog', !!feature);

const height = { m: 556, stated: true, clamped: false };
const cluster = clusterMembers([ridgeMember(markOf(feature, height))]);
const ridge = buildRidge(cluster[0], {});
const col = buildPlumeColumns(ridge);

check('a column is built', !!col, 'null');
check('one volcano, one column', col.columns === 1);
check('the stack is `puffs` rows of four corners', col.positions.length / 3 === P.puffs * 4);
check('every quad is two triangles', col.indices.length === P.puffs * 6);

/* ==> THE FOOT SITS ON THE MOUNTAIN THAT IS DRAWN, NOT ON THE CATALOG. <== A
 * column anchored to `elev` would hang above or sink into the mesh, and which
 * one would depend on the volcano. */
const surf = ridge.surface;
const me = surf.local[0];
const ventZ = surfaceHeightAt(surf.local, surf.k, surf.anySubmarine, me.e, me.n);
const zs = [];
for (let i = 0; i < col.positions.length; i += 3) zs.push(col.positions[i + 2]);
check('the lowest puff sits at the drawn summit', near(Math.min(...zs), ventZ, 1e-6), String(Math.min(...zs) - ventZ));

/* ==> HEIGHT CARRIES THE MOUNTAINS' OWN EXAGGERATION. <== §42.1.5 requires the
 * two to stay in proportion, and this is that rule as arithmetic: change
 * `map3d.vertical` and the column follows without anyone remembering to. */
const topZ = Math.max(...zs);
check(
  'the top is the published height times the mountains own exaggeration',
  near(topZ - ventZ, 556 * M3.vertical * P.exaggerationRatio, 1e-6),
  String(topZ - ventZ)
);

/* ==> THE INDEX ORDER IS THE ENTIRE DEPTH SORT, AND IT MUST BE BASE FIRST.
 * <== The camera is always above the column, so back-to-front is bottom-to-top
 * forever. If this order inverts, twelve transparent quads composite wrong and
 * the fix would be hunted in the shader. */
let ascending = true;
for (let i = 4; i < zs.length; i += 4) {
  if (zs[i] < zs[i - 4]) ascending = false;
}
check('quads are emitted base first, top last', ascending);

/* Widening, and monotonically — a column that narrowed anywhere would read as
 * a waist. */
let widening = true;
for (let i = 4; i < col.halfs.length / 2; i += 4) {
  if (col.halfs[i * 2] < col.halfs[(i - 4) * 2]) widening = false;
}
check('the column widens all the way up', widening);
check('and reaches `spread` times the vent width at the top', near(col.halfs[col.halfs.length - 2], P.ventWidthM * P.spread, 1e-6));

/* The two silhouettes: one dissolves, one stops dead. */
const stated = col.alphas;
check('a stated column fades to nothing at the top', near(stated[stated.length - 1], 0, 1e-6));
check('and is at full opacity at the vent', near(stated[0], P.opacity, 1e-6));

const puffCol = buildPlumeColumns(
  buildRidge(clusterMembers([ridgeMember(markOf(feature, { m: P.unknownM, stated: false, clamped: false }))])[0], {})
);
const flat = puffCol.alphas;
check('an untopped puff keeps the SAME opacity all the way up — it stops dead', near(flat[0], flat[flat.length - 1], 1e-9));
check('and that opacity is dimmer than a stated column at its vent', flat[0] < P.opacity);

/* Nothing erupting ash is the ordinary week, and it must be null rather than
 * an empty mesh — an empty mesh is a draw call and a `P0` that reads as a
 * built column. */
const quiet = buildPlumeColumns(buildRidge(clusterMembers([ridgeMember(markOf(feature, null))])[0], {}));
check('a volcano with no advisory builds nothing at all', quiet === null);

console.log('\n  ' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILED') + '\n');
process.exit(failures === 0 ? 0 : 1);
