/**
 * tools/test-home-frame.mjs — the Home drawer's opening camera frame.
 *
 * WHAT THIS IS ACTUALLY FOR. The failure mode here is not a crash, it is a
 * number that is quietly one zoom level out — which on glass looks like "the
 * storm is just off the edge" and is indistinguishable from a placement bug, a
 * projection bug, or nothing at all. So these assert the RELATIONSHIPS that
 * make the framing correct (further storm ⇒ wider view, higher latitude ⇒ wider
 * view, the band is never left) rather than pinning exact zooms, which would
 * lock in whatever the formula happened to produce on the day.
 *
 * Every assertion below was watched go RED with its rule broken. Noted per
 * block, because a test nobody has seen fail is a test that cannot fail.
 *
 * Plain node, no dependencies:  node tools/test-home-frame.mjs
 */

import {
  homeFrame,
  zoomToFrame,
  clampFrameZoom,
  visibleShortSide,
} from '../map/home-frame.js';
import { GLOBE } from '../config/constants.js';

let pass = 0;
const failures = [];
const ok = (cond, what) => (cond ? pass++ : failures.push(what));

const HOME = { lat: 29.95, lon: -90.07 }; // New Orleans
const PHONE = { width: 390, height: 844 };
const SHEET = { width: 390, height: 500, wide: false };
const RAIL = { width: 340, height: 900, wide: true };
const DESKTOP = { width: 1440, height: 900 };

/* --------------------------------------------------------------------------
 * THE VISIBLE STRIP — the drawer is not part of the picture
 *
 * MUTATION WATCHED: returning the raw viewport short side instead of
 * subtracting the drawer. Both assertions below go red.
 * ------------------------------------------------------------------------ */

{
  const phone = visibleShortSide(PHONE, SHEET);
  ok(phone === 344, `phone strip is the viewport minus the sheet (got ${phone})`);

  const desktop = visibleShortSide(DESKTOP, RAIL);
  ok(desktop === 900, `desktop strip keeps full height, loses the rail (got ${desktop})`);

  /* ==> A SHORT, WIDE WINDOW IS THE ONLY SHAPE THAT PROVES THE RAIL IS
   * SUBTRACTED. <== On a normal 1440×900 desktop the strip is 1100 wide and
   * 900 tall, so the height wins either way and an assertion there passes
   * whether or not the rail was ever taken off — measured, that mutation
   * survived. A 1000×900 window with a 340 rail leaves 660 across, which is
   * narrower than the height, so the rail decides the answer. */
  const shortWide = visibleShortSide({ width: 1000, height: 900 }, RAIL);
  ok(shortWide === 660, `a short wide window loses its width to the rail (got ${shortWide})`);

  /* Garbage in must not produce a zero or a NaN — a zero strip makes every
   * zoom -Infinity and every flight go to the floor. */
  ok(visibleShortSide(null, null) >= 1, 'a missing viewport still yields a usable strip');
  ok(Number.isFinite(visibleShortSide({}, {})), 'an empty viewport is finite');
}

/* --------------------------------------------------------------------------
 * FURTHER AWAY MEANS WIDER — the whole point of the feature
 *
 * MUTATION WATCHED: flipping the division to multiply by the gap. The
 * monotonic assertion goes red at the first pair.
 * ------------------------------------------------------------------------ */

{
  const S = visibleShortSide(PHONE, SHEET);
  const at = (nm) => zoomToFrame({ lat: HOME.lat, nm, shortSide: S });

  const ladder = [50, 150, 400, 900, 1600];
  let monotonic = true;
  for (let i = 1; i < ladder.length; i++) {
    if (at(ladder[i]) > at(ladder[i - 1])) monotonic = false;
  }
  ok(monotonic, 'a further storm never zooms you IN');

  /* And it genuinely moves — a formula that clamped everything to one value
   * would pass the monotonic test above by being flat. */
  ok(at(50) > at(1600), `the band is actually used (${at(50).toFixed(2)} vs ${at(1600).toFixed(2)})`);

  /* Doubling the distance is one zoom level out, which is what halving the
   * scale means. Loose tolerance: the clamp may bite at either end. */
  const a = at(200);
  const b = at(400);
  ok(Math.abs(a - b - 1) < 0.01, `doubling the gap costs one zoom level (${(a - b).toFixed(3)})`);
}

/* --------------------------------------------------------------------------
 * THE STORM ACTUALLY FITS — the assertion that justifies the arithmetic
 *
 * This re-derives the ground distance the returned zoom covers, independently
 * of the function, and checks the storm is inside it.
 *
 * MUTATION WATCHED: using the 256px-tile constant (156543.03) instead of the
 * 512px one. Every case below goes red by a factor of two.
 * ------------------------------------------------------------------------ */

{
  const S = visibleShortSide(PHONE, SHEET);
  const M_PER_PX_Z0 = 40075016.686 / 512;

  for (const nm of [80, 250, 600, 1200]) {
    const z = zoomToFrame({ lat: HOME.lat, nm, shortSide: S });
    if (z <= GLOBE.homeFrameMinZoom + 1e-9) continue; // floored, cannot promise
    if (z >= GLOBE.homeZoom - 1e-9) continue;          // capped, cannot promise

    const mpp = (M_PER_PX_Z0 * Math.cos((HOME.lat * Math.PI) / 180)) / 2 ** z;
    const halfExtentNm = ((S / 2) * mpp) / 1852;

    ok(
      halfExtentNm >= nm,
      `a storm ${nm} nm out is inside the frame (reach ${halfExtentNm.toFixed(0)} nm)`
    );
    /* And not absurdly outside it — a formula that just returned the floor
     * would pass the line above every time. */
    ok(
      halfExtentNm < nm * 2,
      `and the view is not wastefully wide for ${nm} nm (reach ${halfExtentNm.toFixed(0)} nm)`
    );
  }
}

/* --------------------------------------------------------------------------
 * MERCATOR STRETCH — the same gap needs a wider view further north
 *
 * MUTATION WATCHED: dropping the cos(lat) term. Goes red.
 * ------------------------------------------------------------------------ */

{
  const S = visibleShortSide(PHONE, SHEET);
  const miami = zoomToFrame({ lat: 25.8, nm: 400, shortSide: S });
  const anchorage = zoomToFrame({ lat: 61.2, nm: 400, shortSide: S });
  ok(anchorage < miami, `the same gap zooms out further up north (${anchorage.toFixed(2)} < ${miami.toFixed(2)})`);

  /* Southern hemisphere is the same stretch — the sign must not matter. */
  ok(
    Math.abs(
      zoomToFrame({ lat: -25.8, nm: 400, shortSide: S }) - miami
    ) < 1e-9,
    'latitude is used as a magnitude, not a signed value'
  );

  /* A house at either pole must reach the camera as a number, not a NaN.
   *
   * ==> NO ASSERTION HERE COVERS THE `Math.abs` IN THE LATITUDE CLAMP, AND
   * PRETENDING OTHERWISE WOULD BE THE WORSE OPTION. <== Removing it makes
   * `Math.min(85, -90)` return -90, whose cosine is ~0 — but the resulting zoom
   * is enormous and negative, and `clampFrameZoom` floors it to exactly the
   * same value +90 already floors to. Measured: that mutation survives every
   * shape of this test. The `abs` is defensive against a future lower floor,
   * not against anything observable today, and it is labelled as such in the
   * source. These two still earn their place — they catch a NaN or an Infinity
   * escaping to `map.flyTo`, which is a blank globe. */
  ok(Number.isFinite(zoomToFrame({ lat: 90, nm: 400, shortSide: S })), 'a north-polar house is finite');
  ok(Number.isFinite(zoomToFrame({ lat: -90, nm: 400, shortSide: S })), 'a south-polar house is finite');
}

/* --------------------------------------------------------------------------
 * THE BAND IS NEVER LEFT
 *
 * MUTATION WATCHED: removing either side of the clamp. The matching assertion
 * goes red.
 * ------------------------------------------------------------------------ */

{
  const S = visibleShortSide(PHONE, SHEET);

  /* A storm on top of the house must not zoom past "take me to my house". */
  ok(
    zoomToFrame({ lat: HOME.lat, nm: 0.5, shortSide: S }) === GLOBE.homeZoom,
    'a storm on the doorstep stops at homeZoom'
  );

  /* A storm on the far side of the planet must not pull past the floor. */
  ok(
    zoomToFrame({ lat: HOME.lat, nm: 9000, shortSide: S }) === GLOBE.homeFrameMinZoom,
    'a storm on the far side of the world stops at the floor'
  );

  ok(clampFrameZoom(NaN) === GLOBE.homeZoom, 'a NaN zoom falls back to homeZoom, not to space');
  ok(clampFrameZoom(-40) === GLOBE.homeFrameMinZoom, 'a nonsense low zoom is floored');
  ok(clampFrameZoom(99) === GLOBE.homeZoom, 'a nonsense high zoom is capped');

  ok(
    GLOBE.homeFrameMinZoom < GLOBE.homeZoom,
    'the band has a positive width — floor below ceiling'
  );
}

/* --------------------------------------------------------------------------
 * THE WHOLE DECISION — including the two ways it declines
 *
 * MUTATION WATCHED: returning a frame when home is null. Goes red.
 * ------------------------------------------------------------------------ */

{
  const args = { viewport: PHONE, drawerBox: SHEET };

  ok(homeFrame({ home: null, nm: 300, ...args }) === null, 'no home set means the camera does not move');
  ok(
    homeFrame({ home: { lat: NaN, lon: 0 }, nm: 300, ...args }) === null,
    'a broken home is treated as no home, not centred on NaN'
  );

  const noStorm = homeFrame({ home: HOME, nm: null, ...args });
  ok(noStorm !== null, 'with a home and no storm the camera still frames the house');
  ok(noStorm.zoom === GLOBE.homeZoom, 'and it does so at homeZoom — there is no gap to frame');

  const near = homeFrame({ home: HOME, nm: 300, ...args });
  ok(near.center.lat === HOME.lat && near.center.lon === HOME.lon, 'the centre is the house, always');
  ok(near.zoom < GLOBE.homeZoom, 'a storm 300 nm out widens the view');

  /* ==> THE CENTRE IS THE HOUSE EVEN FOR A STORM ON THE OTHER SIDE OF THE
   * WORLD. <== This is the assertion that encodes the whole design argument:
   * Home means you, never "the nearest storm, wherever that is". */
  const far = homeFrame({ home: HOME, nm: 7000, ...args });
  ok(
    far.center.lat === HOME.lat && far.center.lon === HOME.lon,
    'a storm on the far side of the planet does NOT move the centre off the house'
  );

  /* A negative or zero distance is data corruption, not "very close".
   *
   * ==> THESE TWO PIN AN OUTCOME, NOT A BRANCH, AND SAYING SO IS THE POINT.
   * <== Removing the `nm <= 0` guard does NOT turn them red: the arithmetic
   * clamps a sub-1-metre gap up to `homeZoom` anyway, so both paths land on the
   * same answer. Measured — that mutation survived. They are kept because the
   * answer is the one that matters (a corrupt distance must never widen the
   * globe), and left labelled rather than dressed up as proof the guard exists. */
  ok(homeFrame({ home: HOME, nm: -5, ...args }).zoom === GLOBE.homeZoom, 'a negative distance does not widen the view');
  ok(homeFrame({ home: HOME, nm: 0, ...args }).zoom === GLOBE.homeZoom, 'a zero distance does not widen the view');
}

/* --------------------------------------------------------------------------
 * A DESKTOP RAIL FRAMES MORE THAN A PHONE SHEET
 *
 * MUTATION WATCHED: ignoring the drawer box in zoomToFrame's caller. Goes red.
 * ------------------------------------------------------------------------ */

{
  const phone = homeFrame({ home: HOME, nm: 600, viewport: PHONE, drawerBox: SHEET });
  const desk = homeFrame({ home: HOME, nm: 600, viewport: DESKTOP, drawerBox: RAIL });
  ok(desk.zoom > phone.zoom, `a bigger strip can zoom in further (${desk.zoom.toFixed(2)} > ${phone.zoom.toFixed(2)})`);
}

/* ------------------------------------------------------------------------ */

console.log(
  failures.length
    ? `\n✗ ${failures.length} failed:\n  - ${failures.join('\n  - ')}\n  (${pass} passed)`
    : `\n✓ ${pass} assertions passed`
);
console.log('  home drawer opening frame — map/home-frame.js');
if (failures.length) process.exit(1);
