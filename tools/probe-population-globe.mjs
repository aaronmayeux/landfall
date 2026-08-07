/**
 * probe-population-globe.mjs — DOES A HEATMAP LAYER DRAW ON THE GLOBE?
 *
 * ==> THE ONE QUESTION THE UNIT TESTS CANNOT ANSWER. <== `heatmap` is a
 * screen-space effect: MapLibre renders the points into an offscreen density
 * texture, then colours that texture in a second pass. Nothing about that is
 * obviously projection-agnostic, and the globe projection is a different
 * vertex path from mercator. The counting library is pure maths and is tested
 * properly; this file exists because "the paint spec is valid" and "pixels
 * appear on a sphere" are different claims and only one of them was proven.
 *
 * WHAT THIS IS NOT. It is not a look-at-it test. Whether the ramp reads well,
 * whether the cyan fights the cone, whether the radius feels right on a phone —
 * all glass questions, all still open after this passes. This answers exactly
 * one thing: does the layer put its colour on the canvas at all, in globe
 * projection, and does it stop when switched off.
 *
 * NO BASEMAP. The sandbox cannot reach the tile host, and requiring it would
 * make this probe fail for a reason that has nothing to do with the question.
 * The style is a bare background plus our own inline GeoJSON — which is also
 * a fair test, because the population source is inline GeoJSON in the real app
 * too.
 *
 * Run: node tools/probe-population-globe.mjs
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const VENDOR = readFileSync(new URL('../vendor/maplibre-gl-5.6.0.js', import.meta.url), 'utf8');

/** A dense cluster over one spot, so a hit is unambiguous. */
const POINTS = [];
for (let i = 0; i < 400; i += 1) {
  POINTS.push({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [-90 + (Math.random() - 0.5) * 6, 30 + (Math.random() - 0.5) * 6],
    },
    properties: { p: 500000, w: 0.9 },
  });
}

const page_html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body,#m{margin:0;padding:0;width:600px;height:600px;background:#000}</style>
</head><body><div id="m"></div><script>${VENDOR}</script><script>
window.__ready = false;
window.__err = null;
try {
  const map = new maplibregl.Map({
    container: 'm',
    style: {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        pop: { type: 'geojson', data: ${JSON.stringify({ type: 'FeatureCollection', features: POINTS })} }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#04121C' } },
        { id: 'population-heat', type: 'heatmap', source: 'pop',
          paint: {
            'heatmap-weight': ['get', 'w'],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 6, 3, 12, 5, 22, 7, 34, 11, 52],
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
              0, '#0E4A5200', 0.05, '#0E4A5224', 0.14, '#0E4A526B', 0.30, '#1FA8A0B8', 0.58, '#1FA8A0', 1, '#7DF5D8'],
            'heatmap-intensity': 1,
            'heatmap-opacity': 0.72
          }
        }
      ]
    },
    center: [-90, 30],
    zoom: 3,
    attributionControl: false
  });
  /* ==> THE CLIP, TESTED THE WAY THE APP DOES IT. <== A fill polygon over the
   * eastern half of the world, standing in for the ocean, with the heat layer
   * moved underneath it. If the technique works, the towns on the left still
   * glow and the ones on the right are painted over completely. This is the
   * only assertion here that would have caught a coastline bleed. */
  map.on('style.load', () => {
    map.addSource('fakeocean', { type: 'geojson', data: { type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-90, -85], [-70, -85], [-70, 0], [-70, 85], [-90, 85], [-90, 0], [-90, -85]]] },
      properties: {} } });
    map.addLayer({ id: 'ocean', type: 'fill', source: 'fakeocean',
      paint: { 'fill-color': '#04121C', 'fill-opacity': 0.999 } });
    map.moveLayer('population-heat', 'ocean');
  });
  map.on('error', (e) => { window.__err = String(e && e.error && e.error.message || e); });
  map.on('idle', () => { window.__map = map; window.__ready = true; });

  /* ==> THE PIXELS MUST BE READ INSIDE THE RENDER CALLBACK, AND THIS IS THE
   * WHOLE REASON THIS PROBE WAS BRIEFLY WRONG. <== Reading the canvas from
   * outside the render loop — drawImage into a 2D canvas, or a bare
   * readPixels from an evaluate() call — returns a completely black frame.
   * WebGL discards the drawing buffer once it has been composited, and
   * preserveDrawingBuffer does not survive MapLibre's context creation
   * (measured: getContextAttributes() reports false even when asked).
   *
   * An all-black frame is the most dangerous possible false negative here,
   * because "the layer drew nothing" and "the readback is broken" look
   * identical. The tell was that the BACKGROUND layer came back black too,
   * and a background layer cannot fail. Any future probe that reports zero
   * should check the background before believing it. */
  window.__grab = () => new Promise((resolve) => {
    map.once('render', () => {
      const c = map.getCanvas();
      const gl = map.painter.context.gl;
      const px = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      resolve(Array.from(px));
    });
    map.triggerRepaint();
  });
} catch (e) { window.__err = String(e && e.message || e); }
</script></body></html>`;

/**
 * Count pixels that are visibly the heat — green and blue both well clear of
 * red, which is what cyan-teal looks like and what neither the land background
 * nor the ocean fill can produce.
 */
/** The background colour, give or take a bit of blending at the globe's rim. */
function backgroundPixels(data) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - 4) <= 3 && Math.abs(data[i + 1] - 18) <= 3 && Math.abs(data[i + 2] - 28) <= 3) n += 1;
  }
  return n;
}

function heatPixels(data) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (g > 60 && b > 60 && g > r + 30 && b > r + 20) n += 1;
  }
  return n;
}

/** The same test, restricted to one half of the frame. */
function heatPixelsInHalf(data, width, height, rightHalf) {
  let n = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rightHalf !== (x >= width / 2)) continue;
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (g > 60 && b > 60 && g > r + 30 && b > r + 20) n += 1;
    }
  }
  return n;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  const failures = [];
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));

  await page.setContent(page_html, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__ready === true || window.__err !== null', null, { timeout: 30000 });

  console.log('  layer order:', JSON.stringify(await page.evaluate("window.__map.getStyle().layers.map(l=>l.id+':'+l.type)")));
  console.log('  ocean feats:', await page.evaluate("window.__map.querySourceFeatures('fakeocean').length"));
  const err = await page.evaluate('window.__err');
  if (err) failures.push(`map error: ${err}`);

  const read = async () => page.evaluate('window.__grab()');

  const on = await read();
  if (!on) {
    failures.push('no canvas found');
  } else {
    /* The background first. It is #04121C and it cannot fail to draw, so if it
     * is missing the readback is broken and every other number below is a lie. */
    const bg = backgroundPixels(Uint8ClampedArray.from(on));
    console.log(`  background sanity:               ${bg} background pixels`);
    if (bg < 1000) failures.push(`readback is broken — only ${bg} background pixels, expected most of the frame`);
    const lit = heatPixels(Uint8ClampedArray.from(on));
    console.log(`  globe projection, layer visible: ${lit} heat pixels`);
    if (lit < 500) failures.push(`heatmap drew ${lit} heat pixels on the globe — expected thousands`);
  }

  /* THE CLIP. Towns were seeded around -90 lon, so the fake ocean's western
   * edge cuts straight through the cluster: heat to the west of it must
   * survive, heat to the east must be gone. */
  {
    const px = Uint8ClampedArray.from(on);
    const west = heatPixelsInHalf(px, 600, 600, false);
    const east = heatPixelsInHalf(px, 600, 600, true);
    console.log(`  clip — land side / ocean side:   ${west} / ${east}`);
    if (west < 200) failures.push(`clip removed the land-side heat too (${west} pixels)`);
    if (east > 50) failures.push(`heat bled ${east} pixels past the coastline into the ocean`);
  }

  /* And it must STOP. A layer that cannot be switched off is a worse bug than
   * one that never draws, because the switch looks like it works. */
  await page.evaluate("window.__map.setLayoutProperty('population-heat','visibility','none')");
  await page.waitForTimeout(600);
  const off = await read();
  const litOff = heatPixels(Uint8ClampedArray.from(off));
  console.log(`  layer hidden:                    ${litOff} heat pixels`);
  if (litOff > 100) failures.push(`heatmap still drawing ${litOff} pixels when hidden`);

  /* Same question at planet distance, where the globe curvature is extreme and
   * a screen-space effect is most likely to disagree with the sphere. */
  await page.evaluate(`(() => {
    window.__map.setLayoutProperty('population-heat','visibility','visible');
    window.__map.jumpTo({ center: [-90, 30], zoom: 0.5 });
  })()`);
  await page.waitForTimeout(1200);
  const far = await read();
  const litFar = heatPixels(Uint8ClampedArray.from(far));
  console.log(`  planet distance (z0.5):          ${litFar} heat pixels`);
  if (litFar < 50) failures.push(`heatmap vanished at planet distance (${litFar} pixels)`);

  await browser.close();

  if (failures.length) {
    console.error('\nFAILED:');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('\n✓ heatmap renders under globe projection, at two zooms, and hides on command');
  console.log('  (pixels only — whether the ramp READS is a question for a phone)');
}

main().catch((e) => { console.error(e); process.exit(1); });
