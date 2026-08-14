/**
 * tools/test-home-frame.mjs — the Home drawer's opening camera frame.
 *
 * WHAT THIS IS ACTUALLY FOR. The failure mode is not a crash, it is a number
 * quietly one zoom level out — which on glass looks like "the storm is just off
 * the edge" and is indistinguishable from a placement bug, a projection bug, or
 * nothing at all. So the assertions below mostly RE-DERIVE where the two points
 * land on screen at the returned camera and check they are inside the visible
 * strip, independently of the code that chose it. That is the only claim the
 * feature actually makes.
 *
 * Every assertion was watched go RED with its rule broken. The three that could
 * NOT be made to fail are named as such rather than left looking like proof.
 *
 * Plain node, no dependencies:  node tools/test-home-frame.mjs
 */

import { homeFrame, fitPair, visibleStrip } from '../map/home-frame.js';
import { GLOBE } from '../config/constants.js';

let pass = 0;
const failures = [];
const ok = (cond, what) => (cond ? pass++ : failures.push(what));

const NOLA = { lat: 29.95, lon: -90.07 };
const PHONE = { width: 390, height: 844 };
const SHEET = { width: 390, height: 500, wide: false };
const DESKTOP = { width: 1440, height: 900 };
const RAIL = { width: 340, height: 900, wide: true };

/* --------------------------------------------------------------------------
 * A PROJECTION OF OUR OWN, so the assertions do not lean on the code they test
 * ------------------------------------------------------------------------ */

const mx = (lon) => (lon + 180) / 360;
const my = (lat) => {
  const p = (lat * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + p / 2)) / (2 * Math.PI);
};

/** Where a point lands, in pixels from the centre of the visible strip. */
function screenOffset(point, frame) {
  const world = 512 * 2 ** frame.zoom;
  let dLon = point.lon - frame.center.lon;
  while (dLon > 180) dLon -= 360;
  while (dLon < -180) dLon += 360;
  return {
    x: (dLon / 360) * world,
    y: (my(point.lat) - my(frame.center.lat)) * world,
  };
}

/** Is the point inside the strip, measured from the strip's centre? */
const insideStrip = (o, strip) =>
  Math.abs(o.x) <= strip.width / 2 && Math.abs(o.y) <= strip.height / 2;

/* --------------------------------------------------------------------------
 * THE VISIBLE STRIP
 *
 * MUTATION WATCHED: not subtracting the sheet; not subtracting the rail. Each
 * turns its own assertion red.
 * ------------------------------------------------------------------------ */

{
  const phone = visibleStrip(PHONE, SHEET);
  ok(phone.height === 344, `phone strip loses the sheet from its height (got ${phone.height})`);
  ok(phone.width === 390, `phone strip keeps its full width (got ${phone.width})`);

  const desk = visibleStrip(DESKTOP, RAIL);
  ok(desk.width === 1100, `desktop strip loses the rail from its width (got ${desk.width})`);
  ok(desk.height === 900, `desktop strip keeps its full height (got ${desk.height})`);

  /* ==> BOTH DIMENSIONS SURVIVE, AND THIS IS THE ONE THAT CATCHES A COLLAPSE
   * TO THE SHORT SIDE. <== An earlier version of this file returned a single
   * number. An east-west pair would then have been fitted against the phone's
   * 344px height instead of its 390px width and zoomed out further than it had
   * to, on every storm, forever. */
  ok(phone.width !== phone.height, 'the strip keeps width and height apart');

  ok(visibleStrip(null, null).width >= 1, 'a missing viewport still yields a usable strip');
  ok(Number.isFinite(visibleStrip({}, {}).height), 'an empty viewport is finite');
}

/* --------------------------------------------------------------------------
 * THE PAIR IS ACTUALLY ON SCREEN — the claim the whole feature makes
 *
 * MUTATION WATCHED: the 256px world constant; dropping the FILL margin;
 * fitting on width only. All go red here.
 * ------------------------------------------------------------------------ */

{
  const strip = visibleStrip(PHONE, SHEET);
  const cases = [
    ['due east, close', { lat: 29.95, lon: -85.0 }],
    ['due north', { lat: 36.0, lon: -90.07 }],
    ['southeast, mid', { lat: 24.0, lon: -80.0 }],
    ['far east, near the limit', { lat: 29.0, lon: -66.0 }],
    ['northwest', { lat: 40.0, lon: -100.0 }],
  ];

  for (const [name, storm] of cases) {
    const f = homeFrame({ home: NOLA, storm, viewport: PHONE, drawerBox: SHEET });
    if (f.framed !== 'pair') {
      console.log(`  note  ${name}: framed as ${f.framed}, skipped`);
      continue;
    }
    ok(insideStrip(screenOffset(NOLA, f), strip), `${name}: the HOUSE is on screen`);
    ok(insideStrip(screenOffset(storm, f), strip), `${name}: the STORM is on screen`);
  }
}

/* --------------------------------------------------------------------------
 * EQUALLY SPACED — which is what "share the space" means
 *
 * MUTATION WATCHED: centring on the house instead of the midpoint (the
 * behaviour this replaced). Goes red on every case.
 * ------------------------------------------------------------------------ */

{
  for (const storm of [
    { lat: 29.95, lon: -85.0 },
    { lat: 36.0, lon: -90.07 },
    { lat: 24.0, lon: -80.0 },
  ]) {
    const f = homeFrame({ home: NOLA, storm, viewport: PHONE, drawerBox: SHEET });
    const h = screenOffset(NOLA, f);
    const s = screenOffset(storm, f);
    ok(
      Math.abs(Math.hypot(h.x, h.y) - Math.hypot(s.x, s.y)) < 1,
      `house and storm sit the same distance from the centre ` +
        `(${Math.hypot(h.x, h.y).toFixed(1)} vs ${Math.hypot(s.x, s.y).toFixed(1)})`
    );
    /* And on opposite sides of it, not stacked. */
    ok(h.x * s.x <= 0 && h.y * s.y <= 0, 'and on opposite sides of the centre');
  }
}

/* --------------------------------------------------------------------------
 * FURTHER APART MEANS WIDER
 *
 * MUTATION WATCHED: inverting the fit ratio. Goes red at the first pair.
 * ------------------------------------------------------------------------ */

{
  const at = (lon) =>
    homeFrame({ home: NOLA, storm: { lat: 29.95, lon }, viewport: PHONE, drawerBox: SHEET }).zoom;

  const ladder = [-89, -87, -83, -75, -60];
  let monotonic = true;
  for (let i = 1; i < ladder.length; i++) if (at(ladder[i]) > at(ladder[i - 1])) monotonic = false;
  ok(monotonic, 'a storm further away never zooms you IN');
  ok(at(-89) > at(-60), `the band is actually used (${at(-89).toFixed(2)} vs ${at(-60).toFixed(2)})`);

  /* Doubling the separation costs exactly one zoom level. Measured against
   * unclamped values, which is why the near end of this pair is not -89. */
  const a = homeFrame({ home: NOLA, storm: { lat: 29.95, lon: -85 }, viewport: PHONE, drawerBox: SHEET }).zoom;
  const b = homeFrame({ home: NOLA, storm: { lat: 29.95, lon: -80 }, viewport: PHONE, drawerBox: SHEET }).zoom;
  ok(Math.abs(a - b - 1) < 0.01, `doubling the gap costs one zoom level (${(a - b).toFixed(3)})`);
}

/* --------------------------------------------------------------------------
 * MERCATOR STRETCH — the same ground gap needs a wider view further north
 *
 * MUTATION WATCHED: making mercY linear in latitude. Goes red.
 * ------------------------------------------------------------------------ */

{
  const strip = visibleStrip(PHONE, SHEET);
  const gulf = fitPair({
    home: { lat: 25.0, lon: -90 }, storm: { lat: 30.0, lon: -90 }, strip,
  }).zoom;
  const arctic = fitPair({
    home: { lat: 65.0, lon: -90 }, storm: { lat: 70.0, lon: -90 }, strip,
  }).zoom;
  ok(arctic < gulf, `five degrees of latitude needs a wider view up north (${arctic.toFixed(2)} < ${gulf.toFixed(2)})`);
}

/* --------------------------------------------------------------------------
 * THE ANTIMERIDIAN — the bug that would only ever appear in the Pacific
 *
 * MUTATION WATCHED: removing unwrapLon. Both assertions go red, and the
 * midpoint lands in Africa.
 * ------------------------------------------------------------------------ */

{
  const guam = { lat: 13.4, lon: 144.8 };
  const hawaii = { lat: 21.3, lon: -157.8 };
  const strip = visibleStrip(PHONE, SHEET);

  const fit = fitPair({ home: hawaii, storm: guam, strip });

  /* The short way is 57.4° of longitude, not 302.6°. A midpoint taken the long
   * way round lands near longitude -6, in the Atlantic off Africa. */
  ok(
    Math.abs(fit.center.lon) > 150,
    `the midpoint crosses the dateline rather than going the long way (lon ${fit.center.lon.toFixed(1)})`
  );

  const f = homeFrame({ home: hawaii, storm: guam, viewport: PHONE, drawerBox: SHEET });
  if (f.framed === 'pair') {
    ok(insideStrip(screenOffset(hawaii, f), strip), 'a Pacific pair puts the house on screen');
    ok(insideStrip(screenOffset(guam, f), strip), 'a Pacific pair puts the storm on screen');
  } else {
    console.log(`  note  Hawaii/Guam framed as ${f.framed} — too far apart at this strip`);
    ok(f.framed === 'too-far', 'and an unframable Pacific pair says so');
  }
}

/* --------------------------------------------------------------------------
 * THE THREE WAYS IT DECLINES TO FRAME A PAIR
 *
 * MUTATION WATCHED: removing the floor test; removing the ceiling clamp;
 * returning a frame with no home. Each turns its own assertion red.
 * ------------------------------------------------------------------------ */

{
  const args = { viewport: PHONE, drawerBox: SHEET };

  ok(homeFrame({ home: null, storm: NOLA, ...args }) === null, 'no home set means the camera does not move');
  ok(
    homeFrame({ home: { lat: NaN, lon: 0 }, storm: NOLA, ...args }) === null,
    'a broken home is treated as no home, not centred on NaN'
  );

  const none = homeFrame({ home: NOLA, storm: null, ...args });
  ok(none.framed === 'house-only', 'with no storm the drawer frames the house alone');
  ok(none.zoom === GLOBE.homeZoom, 'and does it at homeZoom');
  ok(none.center.lat === NOLA.lat, 'centred on the house');

  /* ==> TOO FAR CHANGES THE CENTRE, NOT JUST THE ZOOM. <== This is the whole
   * argument for the fallback: a midpoint between New Orleans and Tokyo is open
   * Pacific with neither end on screen. */
  const tokyo = { lat: 35.7, lon: 139.7 };
  const far = homeFrame({ home: NOLA, storm: tokyo, ...args });
  ok(far.framed === 'too-far', 'a storm on the far side of the world is not framable');
  ok(
    far.center.lat === NOLA.lat && far.center.lon === NOLA.lon,
    'so the camera goes back to the HOUSE rather than to a midpoint in the ocean'
  );
  ok(far.zoom === GLOBE.homeFrameMinZoom, 'at the floor');

  /* A storm on the doorstep must not zoom closer than "take me to my house". */
  const onTop = homeFrame({ home: NOLA, storm: { lat: 29.96, lon: -90.06 }, ...args });
  ok(onTop.zoom === GLOBE.homeZoom, 'a storm on the doorstep caps at homeZoom');
  ok(onTop.framed === 'too-close', 'and says so');

  /* Exactly coincident — no separation at all, which is a division by zero
   * waiting to happen. */
  const same = homeFrame({ home: NOLA, storm: { ...NOLA }, ...args });
  ok(Number.isFinite(same.zoom), 'a storm exactly on the house yields a finite zoom');
  ok(same.zoom === GLOBE.homeZoom, 'and caps at homeZoom');

  ok(GLOBE.homeFrameMinZoom < GLOBE.homeZoom, 'the band has a positive width');
}

/* --------------------------------------------------------------------------
 * A DESKTOP RAIL FRAMES MORE THAN A PHONE SHEET
 *
 * MUTATION WATCHED: ignoring the drawer box in the fit. Goes red.
 * ------------------------------------------------------------------------ */

{
  const storm = { lat: 26.0, lon: -82.0 };
  const phone = homeFrame({ home: NOLA, storm, viewport: PHONE, drawerBox: SHEET });
  const desk = homeFrame({ home: NOLA, storm, viewport: DESKTOP, drawerBox: RAIL });
  ok(desk.zoom > phone.zoom, `a bigger strip zooms in further (${desk.zoom.toFixed(2)} > ${phone.zoom.toFixed(2)})`);
}

/* --------------------------------------------------------------------------
 * WHAT COULD NOT BE MADE TO FAIL, said plainly
 *
 * The ±85.0511° clamp inside `mercY` is defensive and unobservable: any pair
 * involving a polar house is already unframable, so it takes the `too-far`
 * branch and the clamped value never reaches an output. It stays because the
 * floor is a tunable number. These two assert only that no NaN or Infinity
 * escapes to `map.flyTo`, which would be a blank globe — a real class of bug,
 * just not that one.
 * ------------------------------------------------------------------------ */

{
  const args = { viewport: PHONE, drawerBox: SHEET };
  for (const lat of [90, -90]) {
    const f = homeFrame({ home: { lat, lon: 0 }, storm: { lat: 0, lon: 0 }, ...args });
    ok(Number.isFinite(f.zoom) && Number.isFinite(f.center.lat), `a polar house at ${lat} stays finite`);
  }
}

/* ------------------------------------------------------------------------ */

console.log(
  failures.length
    ? `\n✗ ${failures.length} failed:\n  - ${failures.join('\n  - ')}\n  (${pass} passed)`
    : `\n✓ ${pass} assertions passed`
);
console.log('  home drawer opening frame — map/home-frame.js');
if (failures.length) process.exit(1);
